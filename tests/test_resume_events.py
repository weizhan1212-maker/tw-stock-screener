from pipeline.sources import twse


def test_parse_etf_split():
    body = {"stat": "OK", "fields": ["恢復買賣日期", "ETF代號", "名稱", "分割(反分割)", "停止買賣前收盤價格", "恢復買賣參考價", "漲停價格", "跌停價格", "開盤競價基準"],
            "data": [["114/06/18", "0050", "元大台灣50", "分割", "188.65", "47.16", "51.85", "42.45", "47.16"]]}
    df = twse.parse_resume(body, "ETF分割")
    r = df.iloc[0]
    assert r["code"] == "0050" and str(r["date"].date()) == "2025-06-18"
    assert r["prev_close"] == 188.65 and r["ref_price"] == 47.16 and r["kind"] == "分割"


def test_parse_capital_reduction():
    body = {"stat": "OK", "fields": ["恢復買賣日期", "股票代號", "名稱", "停止買賣前收盤價格", "恢復買賣參考價", "漲停價格", "跌停價格", "開盤競價基準", "除權參考價", "減資原因", "詳細資料"],
            "data": [["114/06/23", "2371", "大同", "40.15", "41.73", "45.90", "37.60", "41.75", "--", "退還股款", "2371  ,20250611"]]}
    r = twse.parse_resume(body, "減資").iloc[0]
    assert r["code"] == "2371" and r["prev_close"] == 40.15 and r["ref_price"] == 41.73
