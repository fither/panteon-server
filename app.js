require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const { getUsers, checkUsers, checkRedis, increase } = require('./db');

app.use(cors());
app.use(express.json());

const PORT = process.env.SERVER_PORT;

(async function() {
  await checkUsers();
  await checkRedis();
})();

app.get('/', (req, res) => {
  res.send('hello');
});

app.post('/increase', async (req, res) => {
  id = req.body.id;

  if(!id) {
    res.send('Please specify id');
  } else {
    const result = await increase(id);
    res.send(result);
  }
});

app.post('/decrease', async (req, res) => {
  id = req.body.id;

  if(!id) {
    res.send('Please specify id');
  } else {
    const result = await increase(id)
    res.send(result);
  }
});

app.get('/users', async (req, res) => {
  const users = await getUsers();

  res.send(users);
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`listening on ${url}`);
});