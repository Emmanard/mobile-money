import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/dist/queueAdapters/bullMQ";
import { transactionQueue } from "./transactionQueue";
import { syncQueue } from "./syncQueue";

export function createQueueDashboard() {
  const router = Router();
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(transactionQueue, { readOnlyMode: false }),
      new BullMQAdapter(syncQueue, { readOnlyMode: false }),
    ],
    serverAdapter: serverAdapter,
    options: {
      uiConfig: {
        boardTitle: "Mobile Money Queue Dashboard",
      },
    },
  });

  router.use("/", serverAdapter.getRouter());

  return router;
}
