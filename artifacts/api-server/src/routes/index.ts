import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import channelsRouter from "./channels";
import tasksRouter from "./tasks";
import telemetryRouter from "./telemetry";
import swarmRouter from "./swarm";
import commandsRouter from "./commands";
import steelRouter from "./steel";
import aiRouter from "./ai";
import neurobuddyRouter from "./neurobuddy";
import externalRouter from "./external";
import integrationsRouter from "./integrations";
import selfCheckRouter from "./selfCheck";
import authRouter from "./auth";
import vaultRouter from "./vault";
import socialRouter from "./social";
import uploadsRouter from "./uploads";
import worldRouter from "./world";
import { requireOperator } from "../lib/auth";

const router: IRouter = Router();

// ── Public (no operator session required) ──
//  - health: load-balancer / Render probes.
//  - auth: the login endpoint itself (chicken-and-egg).
//  - external: protected by its own OPENCLAW_API_KEY (fail-closed).
//  - world: protected by its own x-world-token / operator check.
//  - uploads: GET serves public image URLs (used by social posts); the POST
//    write path is operator-gated inside the router.
router.use(healthRouter);
router.use(authRouter);
router.use(externalRouter);
router.use(worldRouter);
router.use(uploadsRouter);

// ── Operator-only (state-changing or credit-spending) ──
// The dashboard authenticates with the operator session cookie (sent
// automatically on same-origin requests), so these gates are transparent to a
// signed-in operator while closing the API to anonymous internet callers.
router.use("/agents", requireOperator, agentsRouter);
router.use("/channels", requireOperator, channelsRouter);
router.use("/tasks", requireOperator, tasksRouter);
router.use(requireOperator, telemetryRouter);
router.use("/swarm", requireOperator, swarmRouter);
router.use(requireOperator, commandsRouter);
router.use(requireOperator, steelRouter);
router.use(requireOperator, aiRouter);
router.use(requireOperator, neurobuddyRouter);
router.use(requireOperator, integrationsRouter);
router.use(requireOperator, selfCheckRouter);
router.use(requireOperator, vaultRouter);
router.use(requireOperator, socialRouter);

export default router;
