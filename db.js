// TODO: consider adding websocket for realtime showing

// DB START
const { MongoClient } = require('mongodb');

const db_password = encodeURIComponent(process.env.DB_PASSWORD);
const uri = `mongodb+srv://${process.env.DB_USER}:${db_password}@test.bkwis.mongodb.net/panteon?retryWrites=true&w=majority`;
const params = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  connectTimeoutMS: 30000,
  keepAlive: 1
}

// DB END

// REDIS START
redis_host_local = 'localhost';
redis_host_server = 'ec2-34-254-61-94.eu-west-1.compute.amazonaws.com';
redis_port_local = 6379;
redis_port_server = 20309
redis_password_server = 'p0712441886218b236f190a49489f538923316d82083984cb3852ff91dc448b4f';

const asyncRedis = require("async-redis");
const redisClient = asyncRedis.createClient({
  host: process.env.NODE_ENV === 'production' ? redis_host_server : redis_host_local,
  port: process.env.NODE_ENV === 'production' ? redis_port_server : redis_port_local,
  auth_pass: process.env.NODE_ENV === 'production' ? redis_password_server : ''
});

redisClient.on('error', err => {
  console.log('error ' + err);
});

const redis_players = 'players';
const redis_pool = 'pool';
const winnerPlayersCount = 100;
const totalPlayerCount = 100;
// REDIS END

exports.checkPlayers = async() => {
  const client = await MongoClient.connect(uri, params);

  if(!client) {
    return;
  }
  try {
    const db = client.db(process.env.DB_NAME).collection(process.env.DB_COLLECTION_NAME);
  
    db.find({}).toArray((err, res) => {
      // check for players and add if not exist
      let players = [];
      if(!res.length || res.length < totalPlayerCount) {
        const missingPartStart = res.length || 0;
        for(let i = missingPartStart; i < totalPlayerCount; i++) {
          let player = {
            name: `player_${i} `,
            country: 'TUR'
          }
          players.push(player);
        }
    
        db.insertMany(players, (err, result) => {
          if(err) throw err;
        });
      }
    }); 
  } catch(err) {
    console.log(err);
  } finally {
    console.log('players-check completed');
    client.close;
  }
}

// create player's record on redis if not exist
exports.checkRedis = async () => {
  const client = await MongoClient.connect(uri, params);

  if(!client) {
    return;
  }

  try {
    const db = client.db(process.env.DB_NAME).collection(process.env.DB_COLLECTION_NAME);
    
    const players = await db.find({}).toArray();
    
    const result = players.map(async (player) => {
      const playerId = player._id.toString();
      const dailyId = this.getDailyId(playerId);
      
      const ok = await redisClient.exists(playerId);
      if(ok === 0) {
        await redisClient.rpush(redis_players, playerId);
        await redisClient.set(playerId, 0);
      }
      await redisClient.incrby(dailyId, 0);
    });

    Promise.all(result).then(async () => {
      const isPoolExist = await redisClient.exists(redis_pool);
      if(isPoolExist === 0) {
        await redisClient.set(redis_pool, 0);
      };
    });

  } catch(err) {
    console.log(err);
  } finally {
    console.log('check-redis completed');
    client.close();
  }
}

exports.schedulePrizeGiving = async () => {
  // set expiretion to end of week
  const curr = new Date;
  const last = curr.getDate() - curr.getDay() + 7;
  const lastDay = new Date(curr.getFullYear(), curr.getMonth(), last, 23, 59, 59);

  const expireSeconds = Math.floor(Math.floor(lastDay - curr) / 1000);
  // expireSeconds = 15;

  const task = setTimeout(async () => {
    const players = await redisClient.lrange(redis_players, 0, -1);
    // if players exist give prizes
    if(players.length) {
      this.givePrizes();
    } else {
      // if players not exist reschedule for next week
      setTimeout(() => {
        this.schedulePrizeGiving();
      }, 5000);
    }
  }, expireSeconds * 1000);
  console.log(`Prize will be given after ${expireSeconds} seconds.`);
}

exports.givePrizes = async () => {
  // get poolMoney
  const poolMoney = parseInt(await redisClient.get(redis_pool));
  // empty pool
  await redisClient.set(redis_pool, 0);
  // get players to give prizes
  let players = await redisClient.lrange(redis_players, 0, -1);
  players.sort((a,b) => { return b.money - a.money });
  players.slice(0, winnerPlayersCount);

  // calculate prizes
  const firstPrize = Math.floor(poolMoney * 20 / 100);
  const secondPrize = Math.floor(poolMoney * 15 / 100);
  const thirdPrize = Math.floor(poolMoney * 10 / 100);
  const elsePrize = Math.floor(poolMoney * 55 / 100 / 97);

  //give prizes 
  setTimeout(() => {
    const result = players.map(async (player, index) => {
      if(index === 0) {
        await redisClient.incrby(player, firstPrize);
      } else if(index === 1) {
        await redisClient.incrby(player, secondPrize);
      } else if(index === 2) {
        await redisClient.incrby(player, thirdPrize);
      } else {
        await redisClient.incrby(player, elsePrize);
      }
    });

    Promise.all(result)
    .then(() => {
      // reschedule for next week
      this.schedulePrizeGiving();
      console.table({
        firstPrize,
        secondPrize,
        thirdPrize,
        elsePrize
      });
    });
  }, 5000);
}

exports.getDailyId = (playerId, day, month, year) =>  {
  if(!day || !month || !year) {
    const curr = new Date;
    day = curr.getDate();
    month = curr.getMonth() + 1;
    year = curr.getFullYear();
    delete curr;
  }
  const dailyId = `${playerId}_${day}-${month}-${year}`;
  return dailyId
}

exports.getPlayers = async () => {
  const client = await MongoClient.connect(uri, params);

  if(!client) {
    return [];
  }

  try {
    const db = client.db(process.env.DB_NAME).collection(process.env.DB_COLLECTION_NAME);

    const players = await db.find({}).toArray();

    const mapping = players.map(async (player) => {
      const playerId = player._id.toString();
      const dailyId = this.getDailyId(playerId);
      const dailyMoney = await redisClient.get(dailyId);
      const weeklyValue = await this.getWeeklyValue(playerId);

      Object.assign(player, {
        weeklyValue: parseFloat(weeklyValue / 100),
        dailyValue: parseFloat(dailyMoney / 100)
      });
    });

    return Promise.all(mapping)
    .then(() => {
      players.sort((a, b) => { return b.weeklyValue - a.weeklyValue })
    })
    .then(() => {
      return players.slice(0, winnerPlayersCount);
    });
  } catch(err) {
    console.log(err);
  } finally {
    console.log('get-players completed');
    client.close();
  }
}

exports.getWeeklyValue = async (playerId) => {
  const curr = new Date;
  const first = curr.getDate() - curr.getDay();
  const currDay = curr.getDate();
  const currMonth = curr.getMonth() + 1;
  const currYear = curr.getFullYear();
  delete curr;

  let totalMoneyOnWeek = 0;

  for(let i = first; i <= currDay; i++) {
    const id = this.getDailyId(playerId, i, currMonth, currYear);
    const value = parseInt(await redisClient.get(id));
    if(!isNaN(value)) {
      totalMoneyOnWeek += value;
    }
  }

  return totalMoneyOnWeek;
}

exports.increase = async (id) => {
  id = id.toString();
  const idDaily = this.getDailyId(id);

  // add %98 money to player
  const dailyValue = await redisClient.incrby(idDaily, 98);
  const totalValue = await redisClient.incrby(id, 98);
  const weeklyValue = await this.getWeeklyValue(id);

  // add %2 money to pool
  await redisClient.incrby(redis_pool, 2);

  const obj = {
    dailyValue: parseFloat(dailyValue / 100).toString(),
    weeklyValue: parseFloat(weeklyValue / 100).toString(),
  }

  return JSON.stringify(obj);
}

exports.decrease = async (id) => {
  id = id.toString();
  const idDaily = this.getDailyId(id);
  const dailyValue = await redisClient.decrby(idDaily, 100);
  const totalValue = await redisClient.decrby(id, 100);
  const weeklyValue = await this.getWeeklyValue(id);

  const obj = {
    dailyValue: parseFloat(dailyValue / 100).toString(),
    weeklyValue: parseFloat(weeklyValue / 100).toString()
  }

  return JSON.stringify(obj);
}