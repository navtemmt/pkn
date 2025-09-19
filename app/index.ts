import 'dotenv/config'; // load .env first
import express from 'express';
import bot_manager from './bot-manager.ts';
// import { once } from 'node:events'; // only if actually used
// import player_router from './routes/player-routes.ts';
// import db_service from './services/db-service.ts';

// Corrected: Added a closing parenthesis and passed the flag to the bot manager.
const headless_flag = !process.argv.includes('--no-headless');

const app = express();
/* const port = 8080;
app.use(express.json());
app.get('/', (req: any, res:any) => {
  res.json({ message: 'ok' });
});
app.use('/player', player_router);
*/

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

async function startServer() {
  // await db_service.init();
  // await db_service.createTables();
  /* return new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`App listening on http://localhost:${port}`);
      resolve();
    });
  }); */
}

// Option A: async IIFE with try/catch
(async () => {
  try {
    await startServer();
    // Corrected: Pass the headless_flag to the bot_manager
    await bot_manager(headless_flag);
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
})();

// Option B: promise chain (alternative)
// void startServer()
//   .then(() => bot_manager(headless_flag))
//   .catch((err) => {
//     console.error('Fatal startup error:', err);
//     process.exit(1);
//   });

