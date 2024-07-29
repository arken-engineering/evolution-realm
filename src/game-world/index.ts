import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import express, { Express } from 'express';
import { log, logError, isDebug } from '@arken/node/util';
import { catchExceptions } from '@arken/node/util/process';
import { initGameWorld } from './game-world';
import { initMonitor } from './monitor';
import path from 'path';
import http from 'http';
import https from 'https';
import { Server as SocketIOServer } from 'socket.io';
export { Router } from './game-world';

if (isDebug) {
  console.log('Running GS in DEBUG mode');
}
export class Application {
  public server: Express;
  public state: {
    port: number;
    sslPort: number;
    spawnPort?: number;
  };
  public isHttps: boolean;
  public http?: http.Server;
  public https?: https.Server;
  public io?: SocketIOServer;

  constructor() {
    this.server = express();
    this.state = {
      port: process.env.GS_PORT ? parseInt(process.env.GS_PORT, 10) : 8080,
      sslPort: process.env.GS_SSL_PORT ? parseInt(process.env.GS_SSL_PORT, 10) : 8443,
    };
    this.isHttps = process.env.ARKEN_ENV !== 'local';
    this.setupMiddleware();
    this.setupServer();
  }

  private setupMiddleware() {
    this.server.set('trust proxy', 1);
    this.server.use(helmet());
    this.server.use(
      cors({
        allowedHeaders: [
          'Accept',
          'Authorization',
          'Cache-Control',
          'X-Requested-With',
          'Content-Type',
          'applicationId',
        ],
      })
    );
  }

  private setupServer() {
    if (this.isHttps) {
      this.https = https.createServer(
        {
          key: fs.readFileSync(path.resolve('../privkey.pem')),
          cert: fs.readFileSync(path.resolve('../fullchain.pem')),
        },
        this.server
      );
    } else {
      this.http = http.createServer(this.server);
    }

    this.io = new SocketIOServer(this.isHttps ? this.https : this.http, {
      pingInterval: 30 * 1000,
      pingTimeout: 90 * 1000,
      upgradeTimeout: 20 * 1000,
      allowUpgrades: true,
      cookie: false,
      serveClient: false,
      allowEIO3: true,
      cors: {
        origin: '*',
      },
    });
  }

  public start() {
    log('Starting server...', this.isHttps ? 'HTTPS' : 'HTTP');
    catchExceptions();
    try {
      if (this.isHttps && this.https) {
        this.https.listen(this.state.sslPort, () => {
          log(`Backend ready and listening on *:${this.state.sslPort} (https)`);
          this.state.spawnPort = this.state.sslPort;
        });
      } else if (this.http) {
        this.http.listen(this.state.port, () => {
          log(`Backend ready and listening on *:${this.state.port} (http)`);
          this.state.spawnPort = this.state.port;
        });
      }

      initMonitor(this);
      initGameWorld(this);
    } catch (error) {
      logError('Error starting server:', error);
    }
  }
}

const app = new Application();
app.start();