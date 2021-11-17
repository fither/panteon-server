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
const asyncRedis = require("async-redis");
const redisClient = asyncRedis.createClient({
  host: 'localhost',
  port: 6379
});

redisClient.on('error', err => {
  console.log('error ' + err);
});

const redis_players = 'players';
const redis_pool = 'pool';
const winnerPlayersCount = 100;
// REDIS END

exports.checkUsers = async() => {
  const client = await MongoClient.connect(uri, params);

  if(!client) {
    return;
  }
  try {
    const db = client.db(process.env.DB_NAME).collection(process.env.DB_COLLECTION_NAME);
  
    db.find({}).toArray((err, res) => {
      // check for users and add if not exist
      const usersCount = 10;
      let users = [];
      if(!res.length || res.length < usersCount) {
        const missingPartStart = usersCount - res.length;
        for(let i = missingPartStart; i < usersCount; i++) {
          let user = {
            name: `player_${i} `,
            country: 'TUR'
          }
          users.push(user);
        }
    
        db.insertMany(users, (err, result) => {
          if(err) throw err;
        });
      }
    }); 
  } catch(err) {
    console.log(err);
  } finally {
    console.log('users-check completed');
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
    
    const users = await db.find({}).toArray();
    
    const result = users.map(async (user) => {
      const userId = user._id.toString();
      const ok = await redisClient.exists(userId);
      if(ok === 0) {
        await redisClient.rpush(redis_players, userId);
        await redisClient.set(userId, 0);
      }
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
  const last = (curr.getDate() - curr.getDay()) + 7;
  const lastDay = new Date(curr.getFullYear(), curr.getMonth(), last, 23, 59, 59);

  // const expireSeconds = Math.floor(Math.floor(lastDay - curr) / 1000);
  expireSeconds = 15;

  const task = setTimeout(async () => {
    const players = await redisClient.lrange(redis_players, 0, -1);
    if(players.length) {
      this.givePrizes();
    }
  }, expireSeconds * 1000);
  console.log(`Prize will be given after ${expireSeconds} seconds.`);
}

exports.givePrizes = async () => {
  // get poolMoney
  const poolMoney = parseInt(await redisClient.get(redis_pool));
  // empty pool
  await redisClient.set(redis_pool, 0);
  // get users to give prizes
  let users = await redisClient.lrange(redis_players, 0, -1);
  users.sort((a,b) => { return b.money - a.money });
  users.slice(0, winnerPlayersCount);

  // calculate prizes
  const firstPrize = Math.floor(poolMoney * 20 / 100);
  const secondPrize = Math.floor(poolMoney * 15 / 100);
  const thirdPrize = Math.floor(poolMoney * 10 / 100);
  const elsePrize = Math.floor(poolMoney * 55 / 100 / 97);

  //give prizes 
  const result = users.map(async (user, index) => {
    if(index === 0) {
      await redisClient.incrby(user, firstPrize);
    } else if(index === 1) {
      await redisClient.incrby(user, secondPrize);
    } else if(index === 2) {
      await redisClient.incrby(user, thirdPrize);
    } else {
      await redisClient.incrby(user, elsePrize);
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
}

exports.getUsers = async () => {
  const client = await MongoClient.connect(uri, params);

  if(!client) {
    return [];
  }

  try {
    const db = client.db(process.env.DB_NAME).collection(process.env.DB_COLLECTION_NAME);

    const users = await db.find({}).toArray();
    const mapping = users.map(async (user) => {
      const userId = user._id.toString();
      
      const value = await redisClient.get(userId);
      Object.assign(user, {
        money: parseFloat(value / 100)
      });
    });

    return Promise.all(mapping)
    .then(() => {
      users.sort((a, b) => { return b.money - a.money })
    })
    .then(() => {
      return users.slice(0, winnerPlayersCount);
    });
  } catch(err) {
    console.log(err);
  } finally {
    console.log('get-users completed');
    client.close();
  }
}

exports.increase = async (id) => {
  const ok = await redisClient.exists(id);

  if(ok === 1) {
    // add %80 money to player
    const oldPlayerValue = parseInt(await redisClient.get(id));
    const newPlayerValue = oldPlayerValue + 98;
    await redisClient.set(id, newPlayerValue);
    
    // add %20 money to pool
    const oldPoolMoney = parseInt(await redisClient.get(redis_pool));
    const newPoolMoney = oldPoolMoney + 2;
    await redisClient.set(redis_pool, newPoolMoney);

    return parseFloat(newPlayerValue / 100).toString();
  } else {
    return 'user not found';
  }
}

exports.decrease = async (id) => {
  id = id.toString();
  const ok = await redisClient.exists(id);

  if(ok === 1) {
    // remove %100 money from player
    const oldPlayerValue = parseInt(await redisClient.get(id));
    const newPlayerValue = oldPlayerValue - 100;
    await redisClient.set(id, newPlayerValue);

    return parseFloat(newPlayerValue / 100).toString();
  } else {
    return 'user not found';
  }
}