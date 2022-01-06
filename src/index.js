const Binance = require('node-binance-api');
const binance = new Binance().options({
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET
});

exports.handler = async (event) => {
    let dateStr = event.date;
    let [startTime, endTime] = [new Date(dateStr[0]).getTime(), new Date(dateStr[1]).getTime()];
    let trades = [];
    const sevenDaysTime = (1000*(60*60*24*7-1));
    console.log(dateStr[0], dateStr[1], new Date(endTime), new Date(startTime), endTime, startTime, sevenDaysTime);
    if (endTime-startTime > sevenDaysTime) {
        let partialStartTime = startTime;
        let partialEndTime = startTime + sevenDaysTime;
        console.log(new Date(partialStartTime), new Date(endTime));
        while(partialStartTime < endTime) {
            let partialTrades = await binance.futuresUserTrades(undefined, {startTime: partialStartTime, endTime: partialEndTime, limit: 1000});
            if (partialTrades.length == undefined) {
                break;
            }
            console.log(new Date(partialStartTime), new Date(partialEndTime), partialTrades.length);
            trades = trades.concat(partialTrades);
            console.log(trades.length);
            partialStartTime = partialEndTime + 1000;
            partialEndTime = partialStartTime + sevenDaysTime;
        }
    }
    let orderPnl = {};
    console.log(JSON.stringify(trades));
    for (let i in trades) {
        if (parseFloat(trades[i].realizedPnl) != 0.0) {
            const symbol = trades[i].symbol;
            const orderId = trades[i].orderId.toString();
            orderPnl[symbol] = orderPnl[symbol] || {};
            orderPnl[symbol][orderId] = orderPnl[symbol][orderId] || [0, orderId, trades[i].side, getDatetimeStr(trades[i].time).split("T").join(" ")];
            orderPnl[symbol][orderId][0] += parseFloat(parseFloat(trades[i].realizedPnl).toFixed(2));
        }
    }
    let sum = 0;
    let sumcnt = 0;
    for (let symbol in orderPnl) {
        let pnl = 0;
        let cnt = 0;
        let pnls = [];
        let winrate = 0.0;
        for (let orderId in orderPnl[symbol]) {
            pnl += orderPnl[symbol][orderId][0];
            cnt ++;
            if (orderPnl[symbol][orderId][0] > 0) winrate ++;
            pnls.push(orderPnl[symbol][orderId][0].toFixed(1));
            sumcnt++;
        }
        sum += pnl;
        console.log(symbol, pnl, cnt, `${winrate}W${cnt-winrate}L`, pnls.join(","));
    }
    console.log("order count:", sumcnt);
    console.log("summary: ",sum);
    const response = { statusCode: 200, body: "OK" };
    return response;
};

let getDatetimeStr = (time) => {
    return new Date(time).toISOString().split('.')[0];
};
