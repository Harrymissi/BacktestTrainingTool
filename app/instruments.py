INSTRUMENTS = [
    {"id": "SHFE.rb", "name": "螺纹钢", "exchange": "SHFE", "product": "rb", "multiplier": 10, "tick_size": 1},
    {"id": "SHFE.hc", "name": "热卷", "exchange": "SHFE", "product": "hc", "multiplier": 10, "tick_size": 1},
    {"id": "DCE.i", "name": "铁矿石", "exchange": "DCE", "product": "i", "multiplier": 100, "tick_size": 0.5},
    {"id": "DCE.j", "name": "焦炭", "exchange": "DCE", "product": "j", "multiplier": 100, "tick_size": 0.5},
    {"id": "DCE.jm", "name": "焦煤", "exchange": "DCE", "product": "jm", "multiplier": 60, "tick_size": 0.5},
    {"id": "CZCE.SA", "name": "纯碱", "exchange": "CZCE", "product": "SA", "multiplier": 20, "tick_size": 1},
    {"id": "CZCE.FG", "name": "玻璃", "exchange": "CZCE", "product": "FG", "multiplier": 20, "tick_size": 1},
    {"id": "CZCE.MA", "name": "甲醇", "exchange": "CZCE", "product": "MA", "multiplier": 10, "tick_size": 1},
    {"id": "CZCE.TA", "name": "PTA", "exchange": "CZCE", "product": "TA", "multiplier": 5, "tick_size": 2},
    {"id": "DCE.pp", "name": "聚丙烯", "exchange": "DCE", "product": "pp", "multiplier": 5, "tick_size": 1},
    {"id": "DCE.l", "name": "塑料", "exchange": "DCE", "product": "l", "multiplier": 5, "tick_size": 1},
    {"id": "DCE.v", "name": "PVC", "exchange": "DCE", "product": "v", "multiplier": 5, "tick_size": 1},
    {"id": "CZCE.UR", "name": "尿素", "exchange": "CZCE", "product": "UR", "multiplier": 20, "tick_size": 1},
    {"id": "SHFE.cu", "name": "沪铜", "exchange": "SHFE", "product": "cu", "multiplier": 5, "tick_size": 10},
    {"id": "SHFE.al", "name": "沪铝", "exchange": "SHFE", "product": "al", "multiplier": 5, "tick_size": 5},
    {"id": "SHFE.zn", "name": "沪锌", "exchange": "SHFE", "product": "zn", "multiplier": 5, "tick_size": 5},
    {"id": "SHFE.ni", "name": "沪镍", "exchange": "SHFE", "product": "ni", "multiplier": 1, "tick_size": 10},
    {"id": "SHFE.sn", "name": "沪锡", "exchange": "SHFE", "product": "sn", "multiplier": 1, "tick_size": 10},
    {"id": "DCE.m", "name": "豆粕", "exchange": "DCE", "product": "m", "multiplier": 10, "tick_size": 1},
    {"id": "DCE.y", "name": "豆油", "exchange": "DCE", "product": "y", "multiplier": 10, "tick_size": 2},
    {"id": "DCE.p", "name": "棕榈油", "exchange": "DCE", "product": "p", "multiplier": 10, "tick_size": 2},
    {"id": "DCE.a", "name": "豆一", "exchange": "DCE", "product": "a", "multiplier": 10, "tick_size": 1},
    {"id": "DCE.c", "name": "玉米", "exchange": "DCE", "product": "c", "multiplier": 10, "tick_size": 1},
    {"id": "CZCE.CF", "name": "棉花", "exchange": "CZCE", "product": "CF", "multiplier": 5, "tick_size": 5},
    {"id": "CZCE.SR", "name": "白糖", "exchange": "CZCE", "product": "SR", "multiplier": 10, "tick_size": 1},
    {"id": "INE.sc", "name": "原油", "exchange": "INE", "product": "sc", "multiplier": 1000, "tick_size": 0.1},
    {"id": "SHFE.fu", "name": "燃油", "exchange": "SHFE", "product": "fu", "multiplier": 10, "tick_size": 1},
    {"id": "INE.lu", "name": "低硫燃油", "exchange": "INE", "product": "lu", "multiplier": 10, "tick_size": 1},
    {"id": "SHFE.au", "name": "黄金", "exchange": "SHFE", "product": "au", "multiplier": 1000, "tick_size": 0.02},
    {"id": "SHFE.ag", "name": "白银", "exchange": "SHFE", "product": "ag", "multiplier": 15, "tick_size": 1},
]

TIMEFRAMES = {
    "5m": {"label": "5分钟", "seconds": 300},
    "15m": {"label": "15分钟", "seconds": 900},
    "30m": {"label": "30分钟", "seconds": 1800},
    "1h": {"label": "1小时", "seconds": 3600},
    "1d": {"label": "日线", "seconds": 86400},
}

CONTRACT_TYPES = {
    "main": {"label": "主力连续", "prefix": "KQ.m@"},
    "index": {"label": "指数", "prefix": "KQ.i@"},
}


def get_instrument(instrument_id):
    for item in INSTRUMENTS:
        if item["id"] == instrument_id:
            return item
    return None


def tq_symbol(instrument_id, contract_type):
    instrument = get_instrument(instrument_id)
    contract = CONTRACT_TYPES.get(contract_type)
    if not instrument or not contract:
        raise ValueError("Unknown instrument or contract type")
    return f"{contract['prefix']}{instrument['exchange']}.{instrument['product']}"
