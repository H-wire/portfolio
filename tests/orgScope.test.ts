import { requireOrgScope } from "../src/middleware/orgScope";
import { requireOrgRole } from "../src/middleware/roles";

jest.mock("../src/db", () => ({
  query: jest.fn(),
}));

const { query } = jest.requireMock("../src/db");

describe("org scoping", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("sets org context when membership exists", async () => {
    query.mockResolvedValueOnce({ rows: [{ org_id: 1, role: "owner" }] });

    const req: any = { params: { orgId: "1" }, user: { id: 10 } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireOrgScope(req, res, next);

    expect(req.orgId).toBe(1);
    expect(req.orgRole).toBe("owner");
    expect(next).toHaveBeenCalled();
  });

  it("blocks when membership missing", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const req: any = { params: { orgId: "2" }, user: { id: 10 } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireOrgScope(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("org roles", () => {
  it("allows required role", () => {
    const req: any = { orgRole: "admin" };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireOrgRole(["owner", "admin"])(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("blocks missing role", () => {
    const req: any = { orgRole: "viewer" };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireOrgRole(["owner"])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
