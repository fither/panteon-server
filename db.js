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
        for(let i = 0; i < usersCount; i++) {
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
      // set expiretion to end of week at current time
      const curr = new Date; // get current date
      const first = curr.getDate() - curr.getDay(); // First day is the day of the month - the day of the week
      const last = first + 6; // last day is the first day + 6
  
      const expireSeconds = curr - last
  
      await redisClient.expire(redis_players, expireSeconds);

      const isPoolExist = await redisClient.exists(redis_pool);
      if(isPoolExist === 0) {
        await redisClient.set(redis_pool, 0);
      }

      await redisClient.expire(redis_pool, expireSeconds);
    })

  } catch(err) {
    console.log(err);
  } finally {
    console.log('check-redis completed');
    client.close();
  }
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
      return users;
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
    const newPlayerValue = oldPlayerValue + 80;
    await redisClient.set(id, newPlayerValue);
    
    // add %20 money to pool
    const oldPoolMoney = parseInt(await redisClient.get(redis_pool));
    const newPoolMoney = oldPoolMoney + 20;
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