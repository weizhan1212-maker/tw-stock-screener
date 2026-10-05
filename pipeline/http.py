"""HTTP 抓取：每個網站各自限速、失敗自動重試。"""
import logging
import time
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)


class FetchError(Exception):
    pass


class Fetcher:
    def __init__(self, delay: float = 3.0, retries: int = 3, timeout: int = 60, backoff=(10, 30, 60)):
        self.delay = delay              # 同一網站兩次請求的最小間隔（秒）
        self.retries = retries
        self.timeout = timeout
        self.backoff = backoff
        self._last: dict[str, float] = {}
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) tw-stock-screener/1.0",
            "Accept": "application/json, text/plain, */*",
        })
        self.count = 0

    def _wait(self, host: str, delay: float):
        last = self._last.get(host)
        if last is not None:
            gap = time.monotonic() - last
            if gap < delay:
                time.sleep(delay - gap)
        self._last[host] = time.monotonic()

    def get_text(self, url: str, params: dict | None = None, delay: float | None = None) -> str:
        """回傳文字（CSV 等）；先試 UTF-8，再試 Big5（cp950）。"""
        host = urlparse(url).netloc
        err = None
        for attempt in range(self.retries + 1):
            self._wait(host, self.delay if delay is None else delay)
            try:
                r = self.session.get(url, params=params, timeout=self.timeout)
                self.count += 1
                if r.status_code != 200:
                    raise FetchError(f"HTTP {r.status_code}")
                for enc in ("utf-8-sig", "cp950"):
                    try:
                        return r.content.decode(enc)
                    except UnicodeDecodeError:
                        continue
                return r.content.decode("utf-8", errors="replace")
            except (requests.RequestException, FetchError) as e:
                err = e
                if attempt < self.retries:
                    time.sleep(self.backoff[min(attempt, len(self.backoff) - 1)])
        raise FetchError(f"{url}: {err}")

    def get_json(self, url: str, params: dict | None = None, delay: float | None = None):
        """回傳解析後的 JSON；重試用完仍失敗則丟 FetchError。"""
        host = urlparse(url).netloc
        err = None
        for attempt in range(self.retries + 1):
            self._wait(host, self.delay if delay is None else delay)
            try:
                r = self.session.get(url, params=params, timeout=self.timeout)
                self.count += 1
                if r.status_code >= 500 or r.status_code in (403, 429):
                    raise FetchError(f"HTTP {r.status_code}")
                try:
                    return r.json()
                except ValueError:
                    raise FetchError(f"非 JSON 回應（HTTP {r.status_code}）：{r.text[:120]!r}")
            except (requests.RequestException, FetchError) as e:
                err = e
                if attempt < self.retries:
                    wait = self.backoff[min(attempt, len(self.backoff) - 1)]
                    log.warning("抓取失敗 %s（第 %d 次）：%s，%d 秒後重試", url, attempt + 1, e, wait)
                    time.sleep(wait)
        raise FetchError(f"{url} {params}: {err}")
