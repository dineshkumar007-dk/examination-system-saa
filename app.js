import express from "express";
import backendApp from "./backend/src/app.js";

// Vercel detects Express from a direct import in a recognized entry file.
const app = express();
app.disable("x-powered-by");
app.use(backendApp);

export default app;
