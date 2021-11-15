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
// REDIS END

// HELPFUL START

const moment = require('moment');

// HELPFUL END

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
        const result = await redisClient.rpush('players', userId);
      }
      
      await redisClient.set(userId, 0);
    });

    Promise.all(result).then(() => {
      // set expiretion to end of week at current time
      const curr = new Date; // get current date
      const first = curr.getDate() - curr.getDay(); // First day is the day of the month - the day of the week
      const last = first + 6; // last day is the first day + 6
  
      const expireSeconds = curr - last
  
      redisClient.expire('players', expireSeconds);
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
        money: parseInt(value)
      });
    });

    return Promise.all(mapping).then(() => {
      return users;
    })
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
    const newValue = await redisClient.incr(id);
    return newValue.toString();
  } else {
    return 'user not found';
  }
}

exports.decrease = async (id) => {
  id = id.toString();
  const ok = await redisClient.exists(id);

  if(ok === 1) {
    const newValue = await redisClient.decr(id);
    return newValue.toString();
  } else {
    return 'user not found';
  }
}