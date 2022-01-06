const AWS = require('aws-sdk');
AWS.config.region = 'ap-northeast-1';
var lambda = new AWS.Lambda();
const Binance = require('node-binance-api');
const binance = new Binance().options({
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET
});
const dynamo = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME_SIGNALS = "SIGNALS";
const TABLE_NAME_CONDITIONS = "CONDITIONS";
const TABLE_NAME_CURRENT_POSITIONS = "CURRENT_POSITIONS";
const TABLE_NAME_TRADE_HISTORIES = "TRADE_HISTORIES";
const POSITION_NAMES = {"Long": {"Open": "BUY", "Close": "SELL"}, "Short": {"Open": "SELL", "Close": "BUY"}};
const fapi = 'https://fapi.binance.com/fapi/';
const PROFIT_POSITION = {"Long": 1, "Short": -1};

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
    let tradesByPair = {};
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
            //console.log(`${symbol},${orderPnl[symbol][orderId].join(",")}`);
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

let calcProfit = async () => {
    
    let tradeHistories = sortItem(await scanDynamo({ TableName: TABLE_NAME_TRADE_HISTORIES }));
    let tradeHistoriesByPair = {};
    
    for (let i in tradeHistories) {
        const pair = tradeHistories[i].Pair;
        tradeHistoriesByPair[pair] = tradeHistoriesByPair[pair] || [];
        tradeHistoriesByPair[pair].push(tradeHistories[i]);
    }
    
    for (let pair in tradeHistoriesByPair) {
        console.log(pair);
        for (let i in tradeHistoriesByPair[pair]) {
            if (tradeHistoriesByPair[pair][i].Type == "Close") {
                const nextInd = parseInt(i, 10)+1;
                const CloseTrade = tradeHistoriesByPair[pair][i];
                const { Timestamp, Price, Side, Type, Quantity } = tradeHistoriesByPair[pair][i];
                const OpenPrice = tradeHistoriesByPair[pair][nextInd].Price;
                const orderSide = POSITION_NAMES[Side][Type];
                let Profit;
                if (Side == "Long") {
                    Profit = parseFloat(Price * Quantity * 0.9996 - OpenPrice * Quantity * 1.0004).toFixed(2);
                } else {
                    Profit = parseFloat(OpenPrice * Quantity * 1.0004 - Price * Quantity * 0.9996).toFixed(2);
                }
                console.log(`${Profit} = Open: [${tradeHistoriesByPair[pair][nextInd].Timestamp}, ${OpenPrice}], Close: [${Timestamp}, ${Price}] : (${Price}-${OpenPrice})*${Quantity}*${PROFIT_POSITION[Side]} (${Side})`);
                await updateTradeHistoryProfit(Timestamp, Profit);
            }
        }
    }
    
}

let scanDynamo = async (params) => {
    const scanResult = await dynamo.scan(params).promise();
    return scanResult.Items;
};

let updateTradeHistoryProfit = async (timestamp, profit) => {
    var params = {
        TableName:TABLE_NAME_TRADE_HISTORIES,
        Key:{"Timestamp": timestamp},
        UpdateExpression: "set Profit = :p",
        ExpressionAttributeValues:{
            ":p": profit
        },
        ReturnValues:"UPDATED_NEW"
    };
    console.log("Updating the item...");
    return await dynamo.update(params).promise();
};

let updateTradeHistory = async (timestamp, price, size) => {
    var params = {
        TableName:TABLE_NAME_TRADE_HISTORIES,
        Key:{"Timestamp": timestamp},
        UpdateExpression: "set Price = :p, Size = :s",
        ExpressionAttributeValues:{
            ":p": price,
            ":s": size
        },
        ReturnValues:"UPDATED_NEW"
    };
    console.log("Updating the item...");
    return await dynamo.update(params).promise();
};

let updateQuantityUnit = async (Pair, QuantityUnit) => {
    var params = {
        TableName:TABLE_NAME_CONDITIONS,
        Key:{"Pair": Pair},
        UpdateExpression: "set QuantityUnit = :s",
        ExpressionAttributeValues:{
            ":s": QuantityUnit
        },
        ReturnValues:"UPDATED_NEW"
    };
    console.log("Updating the item...");
    return await dynamo.update(params).promise();
};

let updateCurrentPosition = async (Pair, Side, Type) => {
    if (Type == "Close") {
        Side = "None";
    }
    const [currentData] = await scanDynamoOfPair(TABLE_NAME_CURRENT_POSITIONS, Pair);
    console.log(currentData);
    if (!currentData){
        let params = { Pair, Side };
        const putParams = {
            TableName: TABLE_NAME_CURRENT_POSITIONS,
            Item: params
        };
        return await dynamo.put(putParams).promise();
    } else {
        var params = {
            TableName:TABLE_NAME_CURRENT_POSITIONS,
            Key:{"Pair": Pair},
            UpdateExpression: "set Side = :s",
            ExpressionAttributeValues:{
                ":s": Side
            },
            ReturnValues:"UPDATED_NEW"
        };
        console.log("Updating the item...");
        return await dynamo.update(params).promise();
    }
};

let addTradeHistory = async (Side, Pair, Type, Quantity, QuantityUnit) => {
    let params = { Side, Pair, Type, Quantity, QuantityUnit };
    params.Timestamp = getDatetimeStr();
    const putParams = {
        TableName: TABLE_NAME_TRADE_HISTORIES,
        Item: params
    };
    return await dynamo.put(putParams).promise();
};

let fullQuantity = async (pair, account, unit = null) => {
    const prices = await binance.futuresPrices();
    const price = prices[pair];
    let fixUnit = 3;
    const leverage = account.currentPosition.leverage;
    console.log(unit);
    const balance = unit || account.availableBalance;
    if (price < 1000) {
        fixUnit = 2;
    }
    return parseFloat(balance * leverage * 0.95 / price).toFixed(fixUnit);
};

let getLastTradeQuantity = async (pair) => {
    let trades = await scanDynamoOfPair(TABLE_NAME_TRADE_HISTORIES, pair);
    return latestItem(trades).Quantity;
};

let getAccountInfo = async (pair) => {
    let account = await binance.futuresAccount();
    const position = account.positions.find(x => x.symbol === pair);
    return {
        currentPosition: position,
        availableBalance: account.availableBalance
    };
};

let scanDynamoOfPair = async (table, pair) => {
    const params = {
        TableName: table,
        FilterExpression: "Pair = :pair",
        ExpressionAttributeValues: {
            ":pair": pair
        }
    };
    const scanResult = await dynamo.scan(params).promise();
    return scanResult.Items;
};

let sortItem = (item) => {
    return item.sort((a,b) => (a.Timestamp > b.Timestamp) ? -1 : ((b.Timestamp > a.Timestamp) ? 1 : 0));
};

let latestItem = (items) => {
    const sortedItems = sortItem(items);
    return sortedItems[0];
};

let getDatetimeStr = (time) => {
    return new Date(time).toISOString().split('.')[0];
};
