// Express.js Reference Server for HTTP Parity Testing
// This server provides the reference behavior that ChadScript HTTP server should match

const express = require('express');
const app = express();

app.use(express.text());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

app.get('/echo', (req, res) => {
  res.send(req.query.msg || '');
});

app.post('/echo', (req, res) => {
  res.type('text/plain');
  res.send(req.body);
});

app.get('/json', (req, res) => {
  res.json({ message: 'hello', count: 42 });
});

app.get('/status/:code', (req, res) => {
  const code = parseInt(req.params.code, 10);
  res.status(code).send('Status ' + req.params.code);
});

app.get('/headers', (req, res) => {
  res.set('X-Custom-Header', 'test-value');
  res.send('Headers set');
});

app.post('/data', (req, res) => {
  res.json({ received: req.body, method: 'POST' });
});

const port = process.argv[2] || 3001;
app.listen(port, () => {
  console.log(`Express reference server running on port ${port}`);
});
