# Trading Backtest Replay

本项目是一个纯本地期货复盘训练网站。后端通过 TQSDK 专业版下载国内期货主力连续 / 指数 K 线并缓存到 SQLite，前端逐根播放 K 线，支持 BOLL、MACD、模拟开平仓、止盈止损和历史复盘加载。

## 启动

1. 安装 Python 3.10+
2. 安装依赖：

```powershell
pip install -r requirements.txt
```

3. 确认 `.env` 中已经配置 TQSDK 账号密码。
4. 启动本地服务：

```powershell
python app/server.py
```

5. 打开：

```text
http://127.0.0.1:8765
```

## 第一版规则

- 周期：5分钟、15分钟、30分钟、1小时、日线。
- 合约类型：主力连续、指数。
- 开仓 / 手动平仓：按当前 K 线收盘价成交。
- 止盈止损：当前 K 线高低价触碰目标价后，按目标价成交。
- 同一时间只允许一笔持仓。
- 指标只使用已经播放出来的 K 线计算，不看未来。

## 数据说明

TQSDK 合约代码使用：

- 主力连续：`KQ.m@交易所.品种`
- 指数：`KQ.i@交易所.品种`

下载接口使用专业版 `api.get_kline_data_series(...)`。
