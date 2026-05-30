import { Router, Request, Response, NextFunction } from "express";
import { AccountingService, AccountingProvider } from "../services/accounting";
import { requireAuth } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const router = Router();
const accountingService = new AccountingService();

// Validation schemas
const connectQuickBooksCallbackSchema = z.object({
  code: z.string(),
  realmId: z.string(),
  state: z.string(),
});

const connectXeroSchema = z.object({
  code: z.string(),
});

const createCategoryMappingSchema = z.object({
  connectionId: z.string().uuid(),
  mobileMoneyCategory: z.string().min(1),
  accountingCategoryId: z.string().min(1),
  accountingCategoryName: z.string().min(1),
});

const syncDataSchema = z.object({
  connectionId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
});

// Middleware to ensure user is authenticated
router.use(requireAuth);

// Get authorization URLs
router.get("/quickbooks/auth", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = uuidv4();
    // Store state in session for CSRF protection
    (req.session as any).qbOAuthState = state;
    
    const authUrl = accountingService.getQuickBooksAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
});

router.get("/xero/auth", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = uuidv4();
    (req.session as any).xeroOAuthState = state;
    
    const authUrl = accountingService.getXeroAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
});

// Handle OAuth callbacks
router.get(
  "/quickbooks/callback",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, realmId, state } = req.query as { code: string; realmId: string; state: string };
      const userId = (req as any).user.id;

      // Validate state
      const savedState = (req.session as any).qbOAuthState;
      if (!state || state !== savedState) {
        return res.status(400).json({ error: "Invalid state parameter" });
      }
      delete (req.session as any).qbOAuthState;

      const connection = await accountingService.handleQuickBooksCallback(code, realmId, userId);
      
      res.json({
        message: "QuickBooks connected successfully",
        connectionId: connection.id,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/xero/callback",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, state } = req.query as { code: string; state: string };
      const userId = (req as any).user.id;

      // Validate state
      const savedState = (req.session as any).xeroOAuthState;
      if (!state || state !== savedState) {
        return res.status(400).json({ error: "Invalid state parameter" });
      }
      delete (req.session as any).xeroOAuthState;

      const connection = await accountingService.handleXeroCallback(code, userId);
      
      res.json({
        message: "Xero connected successfully",
        connectionId: connection.id,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get user's accounting connections
router.get("/connections", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const connections = await accountingService.getUserConnections(userId);

    // Don't expose sensitive tokens
    const safeConnections = connections.map(conn => ({
      id: conn.id,
      provider: conn.provider,
      realmId: conn.realmId,
      tenantId: conn.tenantId,
      isActive: conn.isActive,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));

    res.json({ connections: safeConnections });
  } catch (error) {
    next(error);
  }
});

// Get accounting categories for a connection
router.get(
  "/connections/:connectionId/categories",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId } = req.params;
      const userId = (req as any).user.id;

      // Verify user owns this connection
      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const categories = await accountingService.getAccountingCategories(connectionId);
      res.json({ categories });
    } catch (error) {
      next(error);
    }
  }
);

// Create category mapping
router.post(
  "/category-mappings",
  validateRequest(createCategoryMappingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId, mobileMoneyCategory, accountingCategoryId, accountingCategoryName } = req.body;
      const userId = (req as any).user.id;

      // Verify user owns this connection
      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const mapping = await accountingService.createCategoryMapping(
        connectionId,
        mobileMoneyCategory,
        accountingCategoryId,
        accountingCategoryName
      );

      res.status(201).json({ mapping });
    } catch (error) {
      next(error);
    }
  }
);

// Get category mappings for a connection
router.get(
  "/connections/:connectionId/category-mappings",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId } = req.params;
      const userId = (req as any).user.id;

      // Verify user owns this connection
      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const mappings = await accountingService.getCategoryMappings(connectionId);
      res.json({ mappings });
    } catch (error) {
      next(error);
    }
  }
);

// Manual sync triggers
router.post(
  "/sync/daily-pnl",
  validateRequest(syncDataSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId, date } = req.body;
      const userId = (req as any).user.id;

      // Verify user owns this connection
      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const syncLog = await accountingService.syncDailyPnL(connectionId, date);
      res.json({ syncLog });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/sync/fee-revenue",
  validateRequest(syncDataSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId, date } = req.body;
      const userId = (req as any).user.id;

      // Verify user owns this connection
      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const syncLog = await accountingService.syncFeeRevenue(connectionId, date);
      res.json({ syncLog });
    } catch (error) {
      next(error);
    }
  }
);

// Get sync logs for a connection
router.get(
  "/connections/:connectionId/sync-logs",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const userId = (req as any).user.id;

      // Verify user owns this connection
      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const syncLogs = await accountingService.getSyncLogs(connectionId, limit);
      res.json({ syncLogs });
    } catch (error) {
      next(error);
    }
  }
);

// Delete a connection
router.delete(
  "/connections/:connectionId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectionId } = req.params;
      const userId = (req as any).user.id;

      const connection = await accountingService.getConnection(connectionId);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      // Soft delete by setting is_active to false
      const { pool } = await import("../config/database");
      await pool.query(
        "UPDATE accounting_connections SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [connectionId]
      );

      res.json({ message: "Connection deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
