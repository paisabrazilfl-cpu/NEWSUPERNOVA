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

const router: IRouter = Router();

router.use(healthRouter);
router.use("/agents", agentsRouter);
router.use("/channels", channelsRouter);
router.use("/tasks", tasksRouter);
router.use(telemetryRouter);
router.use("/swarm", swarmRouter);
router.use(commandsRouter);
router.use(steelRouter);
router.use(aiRouter);

export default router;
