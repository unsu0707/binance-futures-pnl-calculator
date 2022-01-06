const Binance = require("node-binance-api");
const binance = new Binance().options({
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
});

exports.handler = async (event) => {
  let dateStr = event.date;
  let [startTime, endTime] = [
    new Date(dateStr[0]).getTime(),
    new Date(dateStr[1]).getTime(),
  ];
  let trades = [];
  const sevenDaysTime = 1000 * (60 * 60 * 24 * 7 - 1);
  if (endTime - startTime > sevenDaysTime) {
    let partialStartTime = startTime;
    let partialEndTime = startTime + sevenDaysTime;
    while (partialStartTime < endTime) {
      let partialTrades = await binance.futuresUserTrades(undefined, {
        startTime: partialStartTime,
        endTime: partialEndTime,
        limit: 1000,
      });
      if (partialTrades.length == undefined) {
        break;
      }
      trades = trades.concat(partialTrades);
      partialStartTime = partialEndTime + 1000;
      partialEndTime = partialStartTime + sevenDaysTime;
    }
  }
  let orderPnl = {};
  for (let i in trades) {
    if (parseFloat(trades[i].realizedPnl) != 0.0) {
      const symbol = trades[i].symbol;
      const orderId = trades[i].orderId.toString();
      orderPnl[symbol] = orderPnl[symbol] || {};
      orderPnl[symbol][orderId] = orderPnl[symbol][orderId] || [
        0,
        orderId,
        trades[i].side,
        getDatetimeStr(trades[i].time).split("T").join(" "),
      ];
      orderPnl[symbol][orderId][0] += parseFloat(
        parseFloat(trades[i].realizedPnl).toFixed(2)
      );
    }
  }
  let allPnl = 0;
  let allOrderCount = 0;
  for (let symbol in orderPnl) {
    let pnl = 0;
    let orderCount = 0;
    let pnls = [];
    let winCount = 0;
    for (let orderId in orderPnl[symbol]) {
      pnl += orderPnl[symbol][orderId][0];
      cnt++;
      if (orderPnl[symbol][orderId][0] > 0) winCount++;
      pnls.push(orderPnl[symbol][orderId][0].toFixed(1));
      orderCount++;
    }
    allPnl += pnl;
    console.log(
      symbol,
      pnl,
      orderCount,
      `${winCount}W${orderCount - winCount}L`,
      pnls.join(",")
    );
  }
  console.log("order count:", allOrderCount);
  console.log("summary: ", allPnl);
  const response = { statusCode: 200, body: "OK" };
  return response;
};

let getDatetimeStr = (time) => {
  return new Date(time).toISOString().split(".")[0];
};
