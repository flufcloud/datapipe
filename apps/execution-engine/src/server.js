import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 4001;
const app = createApp();

app.listen(port, () => {
  console.log(`execution-engine listening on http://127.0.0.1:${port}`);
});
