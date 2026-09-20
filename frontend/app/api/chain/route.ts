// The fly brain's transaction count on Thru, proxied from the Python backend so the browser stays
// same-origin. The backend (fly-brain/python/server.py --chain) pushes one transaction per synapse
// and serves the running totals at /api/chain. 8000 is server.py's own default port; set FLY_API to
// point somewhere else (the counter shows nothing at all when this address answers nothing).
export const dynamic = "force-dynamic";

const BACKEND = process.env.FLY_API ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/chain`, { cache: "no-store" });
    if (!res.ok) throw new Error(`backend said ${res.status}`);
    return Response.json(await res.json());
  } catch (e) {
    // the brain view works without the chain: report it and let the counter stay hidden
    return Response.json({ available: false, error: String((e as Error).message ?? e) }, { status: 200 });
  }
}
