import axios from "axios";
import { randomUUID } from "crypto";
import logger from "../../../utils/logger";

interface MtnBalanceResponse {
  availableBalance?: string | number;
  balance?: string | number;
  currency?: string;
}

export interface BatchPayoutItem {
  referenceId: string;
  phoneNumber: string;
  amount: string;
}

export interface BatchPayoutResult {
  referenceId: string;
  success: boolean;
  error?: string;
  providerReference?: string;
}

export class MTNProvider {
  private apiKey: string;
  private apiSecret: string;
  private subscriptionKey: string;
  private baseUrl = "https://sandbox.momodeveloper.mtn.com";
  private environment: string;

  constructor() {
    this.apiKey = process.env.MTN_API_KEY || "";
    this.apiSecret = process.env.MTN_API_SECRET || "";
    this.subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY || "";
    this.environment = process.env.MTN_TARGET_ENVIRONMENT || "sandbox";
    if (process.env.MTN_BASE_URL) {
      this.baseUrl = process.env.MTN_BASE_URL;
    }
  }

  private async getAccessToken(): Promise<string> {
    const response = await axios.post(
      `${this.baseUrl}/collection/token/`,
      undefined,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString("base64"),
          "Ocp-Apim-Subscription-Key": this.subscriptionKey,
        },
      },
    );

    const token = response.data?.access_token;
    if (!token || typeof token !== "string") {
      throw new Error("MTN token response did not include access_token");
    }

    return token;
  }

  async getOperationalBalance() {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get<MtnBalanceResponse>(
        `${this.baseUrl}/disbursement/v1_0/account/balance`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            "X-Target-Environment": this.environment,
          },
        },
      );

      const availableRaw =
        response.data.availableBalance ?? response.data.balance ?? 0;
      const availableBalance =
        typeof availableRaw === "number"
          ? availableRaw
          : Number.parseFloat(String(availableRaw));

      if (!Number.isFinite(availableBalance)) {
        throw new Error("Invalid MTN balance response");
      }

      return {
        success: true,
        data: {
          availableBalance,
          currency: response.data.currency || "XAF",
        },
      };
    } catch (error) {
      return { success: false, error };
    }
  }

  async requestPayment(phoneNumber: string, amount: string, requestId?: string) {
    const log = requestId ? logger.child({ requestId }) : logger;
    log.info({ phoneNumber, amount }, "MTN: Requesting payment");
    const startTime = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        {
          amount,
          currency: "EUR",
          externalId: randomUUID(),
          payer: { partyIdType: "MSISDN", partyId: phoneNumber },
          payerMessage: "Payment for Stellar deposit",
          payeeNote: "Deposit",
        },
        {
          headers: {
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            "X-Target-Environment": "sandbox",
          },
        },
      );

      const duration = Date.now() - startTime;
      log.info({ duration, status: response.status }, "MTN: Payment request successful");

      return { 
        success: true, 
        data: response.data,
        providerResponseTimeMs: duration
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      log.error({ 
        duration, 
        error: error.message,
        response: error.response?.data
      }, "MTN: Payment request failed");
      return { 
        success: false, 
        error,
        providerResponseTimeMs: duration
      };
    }
  }

  async sendPayout(phoneNumber: string, amount: string, requestId?: string) {
    const log = requestId ? logger.child({ requestId }) : logger;
    log.info({ phoneNumber, amount }, "MTN: Sending payout");
    return { success: true };
  }

  /**
   * MTN B2B Batch Payout - Process up to 100 payouts in a single API call.
   * Sends the batch then polls the MTN batch status endpoint until items
   * reach a terminal state or a timeout is reached. Individual item
   * failures are returned so callers can resolve them independently.
   */
  async sendBatchPayout(items: BatchPayoutItem[], requestId?: string): Promise<{ success: boolean; results: BatchPayoutResult[]; error?: unknown }> {
    const log = requestId ? logger.child({ requestId }) : logger;
    const MAX_BATCH_SIZE = 100;
    
    if (items.length === 0) {
      return { success: true, results: [] };
    }

    if (items.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        results: items.map(item => ({
          referenceId: item.referenceId,
          success: false,
          error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`,
        })),
        error: new Error(`Batch size ${items.length} exceeds maximum of ${MAX_BATCH_SIZE}`),
      };
    }

    log.info({ itemCount: items.length }, "MTN: Starting batch payout");
    const startTime = Date.now();

    try {
      const token = await this.getAccessToken();
      const batchReference = `BATCH-${randomUUID()}`;

      // MTN disbursement batch API endpoint
      const response = await axios.post(
        `${this.baseUrl}/disbursement/v2_0/batch-payout`,
        {
          batchReference,
          items: items.map(item => ({
            referenceId: item.referenceId,
            amount: item.amount,
            currency: "XAF",
            payee: {
              partyIdType: "MSISDN",
              partyId: item.phoneNumber,
            },
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            "X-Target-Environment": this.environment,
            "Content-Type": "application/json",
          },
        },
      );

      const duration = Date.now() - startTime;

      // If API provided immediate per-item results, use them. Otherwise poll.
      let responseItems = response.data?.items ?? [];
      const providedBatchId = response.data?.batchReference || response.data?.batchId || batchReference;

      const headers = {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
        "X-Target-Environment": this.environment,
      };

      const terminalStatuses = new Set([
        "SUCCESSFUL",
        "SUCCESS",
        "FAILED",
        "ERROR",
        "REJECTED",
        "CANCELLED",
      ]);
      const pendingStatuses = new Set([
        "PENDING",
        "IN_PROGRESS",
        "PROCESSING",
        "SUBMITTED",
        "QUEUED",
      ]);

      const responseHasReferenceIds = responseItems.some((ri: any) => {
        return ri?.referenceId !== undefined && ri?.referenceId !== null;
      });

      // Poll for status if items are missing or any item appears not-terminal
      const needsPolling =
        responseItems.length === 0 ||
        responseItems.some((ri: any) => {
          const s = String(ri.status ?? "").toUpperCase();
          return pendingStatuses.has(s) || !terminalStatuses.has(s);
        });

      if (needsPolling) {
        const pollUrls = [
          `${this.baseUrl}/disbursement/v2_0/batch-payout/${encodeURIComponent(providedBatchId)}`,
          `${this.baseUrl}/disbursement/v2_0/batch-payout/status/${encodeURIComponent(providedBatchId)}`,
          `${this.baseUrl}/disbursement/v2_0/batch-payouts/${encodeURIComponent(providedBatchId)}`,
        ];

        const maxAttempts = Number.parseInt(
          process.env.MTN_BATCH_PAYOUT_MAX_ATTEMPTS || "10",
          10,
          
        );
        const delayMs = Number.parseInt(
          process.env.MTN_BATCH_PAYOUT_POLL_DELAY_MS || "1000",
          10,
        );

        const safeMaxAttempts = Number.isFinite(maxAttempts) ? maxAttempts : 10;
        const safeDelayMs = Number.isFinite(delayMs) ? delayMs : 1000;

        for (let attempt = 0; attempt < safeMaxAttempts; attempt++) {
          try {
            let statusResp: any = null;
            for (const url of pollUrls) {
              try {
                statusResp = await axios.get(url, { headers });
                if (statusResp?.data) break;
              } catch {
                // try next candidate
              }
            }

            if (!statusResp?.data) {
              await new Promise(r => setTimeout(r, safeDelayMs));
              continue;
            }

            responseItems =
              statusResp.data.items ??
              statusResp.data?.results ??
              responseItems;

            const allFinal = responseItems.length > 0 &&
              responseItems.every((ri: any) => {
                const s = String(ri.status ?? "").toUpperCase();
                return terminalStatuses.has(s);
              });

            if (allFinal) break;
          } catch {
            // swallow and retry
          }

          await new Promise(r => setTimeout(r, safeDelayMs));
        }
      }

      const getProviderReference = (ri: any): string | undefined => {
        return (
          ri?.financialTransactionId ||
          ri?.providerReference ||
          ri?.transactionId ||
          ri?.transaction_id ||
          ri?.transaction_id_response
        );
      };

      // Build results for caller
      const results: BatchPayoutResult[] = items.map(item => {
        // Prefer matching on echoed referenceId, but fall back to phone+amount if absent.
        const responseItem = responseHasReferenceIds
          ? responseItems.find(
              (r: any) => r?.referenceId !== undefined && String(r.referenceId) === String(item.referenceId),
            )
          : undefined;

        const fallbackItem = !responseItem
          ? responseItems.find((ri: any) => {
              const phone = String(ri?.phoneNumber ?? ri?.payee?.partyId ?? "");
              const amt = String(ri?.amount ?? "");
              return phone === String(item.phoneNumber) && amt === String(item.amount);
            })
          : undefined;

        const matched = responseItem ?? fallbackItem;

        if (!matched) {
          return {
            referenceId: item.referenceId,
            success: false,
            error: "No response received for this item",
          };
        }

        const status = String(matched.status ?? "").toUpperCase();
        const providerReference = getProviderReference(matched);
        const success = status === "SUCCESSFUL" || status === "SUCCESS";

        return {
          referenceId: item.referenceId,
          success,
          error: success
            ? undefined
            : matched.errorReason || matched.message || `Status: ${status}`,
          providerReference,
        };
      });


      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      log.info({ 
        duration, 
        successCount, 
        failureCount,
        batchReference: providedBatchId,
      }, "MTN: Batch payout completed");

      return {
        success: successCount > 0 || failureCount === 0,
        results,
        error: failureCount > 0 && successCount === 0 
          ? new Error("All batch items failed") 
          : undefined,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMessage = error.message || "Batch payout request failed";
      
      log.error({ 
        duration, 
        error: errorMessage,
        itemCount: items.length
      }, "MTN: Batch payout failed");

      return {
        success: false,
        results: items.map(item => ({
          referenceId: item.referenceId,
          success: false,
          error: errorMessage,
        })),
        error,
      };
    }
  }

  async getTransactionStatus(
    referenceId: string,
  ): Promise<{ status: "completed" | "failed" | "pending" | "unknown" }> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(
        `${this.baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            "X-Target-Environment": this.environment,
          },
        },
      );
      const providerStatus = String(
        response.data?.status ?? "",
      ).toUpperCase();
      if (providerStatus === "SUCCESSFUL") return { status: "completed" };
      if (providerStatus === "FAILED") return { status: "failed" };
      if (providerStatus === "PENDING") return { status: "pending" };
      return { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  }
}
