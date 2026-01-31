// Express.js Reference Server for HTTP Parity Testing
// This server provides the reference behavior that ChadScript HTTP server should match

import express, { Request, Response } from 'express';
const app = express();

app.use(express.text());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('Hello from Express!');
});

app.get('/echo', (req: Request, res: Response) => {
  res.send((req.query.msg as string) || '');
});

app.post('/echo', (req: Request, res: Response) => {
  res.type('text/plain');
  res.send(req.body);
});

app.get('/json', (req: Request, res: Response) => {
  res.json({ message: 'hello', count: 42 });
});

app.get('/status/:code', (req: Request, res: Response) => {
  const code = parseInt(req.params.code, 10);
  res.status(code).send('Status ' + req.params.code);
});

app.get('/headers', (req: Request, res: Response) => {
  res.set('X-Custom-Header', 'test-value');
  res.send('Headers set');
});

app.post('/data', (req: Request, res: Response) => {
  res.json({ received: req.body, method: 'POST' });
});

const port = process.argv[2] || 3001;
app.listen(port, () => {
  console.log(`Express reference server running on port ${port}`);
});
