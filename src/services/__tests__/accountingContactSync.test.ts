import { AccountingService, AccountingProvider } from "../accounting";
import { pool } from "../../config/database";

jest.mock("../../config/database");
jest.mock("axios");
jest.mock("uuid");

const mockPool = pool as jest.Mocked<typeof pool>;
const mockAxios = require("axios");
const mockUuid = require("uuid");

describe("AccountingService.syncContactForUser", () => {
  let accountingService: AccountingService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUuid.v4.mockReturnValue("test-uuid-123");
    process.env.XERO_CLIENT_ID = "test-xero-client-id";
    process.env.XERO_CLIENT_SECRET = "test-xero-client-secret";
    process.env.XERO_REDIRECT_URI = "http://localhost:3000/auth/xero/callback";
    accountingService = new AccountingService();
  });

  it("reuses an existing Xero contact matched by email", async () => {
    const userRow = [{ id: "user-1", first_name: "Alice", last_name: "Smith", email: "alice@example.com" }];
    const xeroConnection = [{ id: "conn-1", user_id: "user-1", provider: AccountingProvider.XERO, tenant_id: "tenant-1", access_token: "token", refresh_token: "r", expires_at: new Date(), is_active: true, created_at: new Date(), updated_at: new Date() }];

    // 1: fetch user
    mockPool.query.mockResolvedValueOnce({ rows: userRow });
    // 2: getUserConnections
    mockPool.query.mockResolvedValueOnce({ rows: xeroConnection });
    // 3: check existing mapping -> none
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // 4: axios.get contacts returns a matching contact
    mockAxios.get.mockResolvedValue({ data: { Contacts: [ { ContactID: "contact-123", EmailAddress: "alice@example.com" } ] } });
    // 5: insert mapping
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await accountingService.syncContactForUser("user-1");

    // Ensure we looked up contacts and inserted mapping
    expect(mockAxios.get).toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO accounting_contact_mappings"), expect.any(Array));
  });

  it("creates a new Xero contact when none match the email", async () => {
    const userRow = [{ id: "user-2", first_name: "Bob", last_name: "Jones", email: "bob@example.com" }];
    const xeroConnection = [{ id: "conn-2", user_id: "user-2", provider: AccountingProvider.XERO, tenant_id: "tenant-2", access_token: "token2", refresh_token: "r2", expires_at: new Date(), is_active: true, created_at: new Date(), updated_at: new Date() }];

    mockPool.query.mockResolvedValueOnce({ rows: userRow });
    mockPool.query.mockResolvedValueOnce({ rows: xeroConnection });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // No existing contacts
    mockAxios.get.mockResolvedValue({ data: { Contacts: [] } });

    // Creating contact returns created contact
    mockAxios.post.mockResolvedValue({ data: { Contacts: [ { ContactID: "new-contact-1" } ] } });

    // Insert mapping result
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await accountingService.syncContactForUser("user-2");

    expect(mockAxios.post).toHaveBeenCalledWith(
      "https://api.xero.com/api.xro/2.0/Contacts",
      expect.any(Object),
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO accounting_contact_mappings"), expect.any(Array));
  });
});
