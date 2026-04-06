"""
Stress Test — hiringpipeline.vercel.app
Uses only requests + concurrent.futures (stdlib).
"""

import time
import statistics
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://hiringpipeline.vercel.app"
TIMEOUT = 10


def make_request(url):
    """Fire a single GET request. Returns (success: bool, latency_ms: float)."""
    try:
        start = time.perf_counter()
        r = requests.get(url, timeout=TIMEOUT)
        latency = (time.perf_counter() - start) * 1000
        return (200 <= r.status_code < 300, latency, r.status_code)
    except Exception:
        latency = (time.perf_counter() - start) * 1000
        return (False, latency, 0)


def run_test(name, url, total, concurrency):
    """Run `total` requests at `concurrency` level and print results."""
    results = []
    wall_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(make_request, url) for _ in range(total)]
        for f in as_completed(futures):
            results.append(f.result())

    wall_time = time.perf_counter() - wall_start

    successes = [r for r in results if r[0]]
    failures = [r for r in results if not r[0]]
    latencies = sorted(r[1] for r in results)

    avg = statistics.mean(latencies)
    p50 = latencies[int(len(latencies) * 0.50)]
    p95 = latencies[int(len(latencies) * 0.95) - 1]
    p99 = latencies[int(len(latencies) * 0.99) - 1]
    mx = latencies[-1]
    throughput = total / wall_time if wall_time > 0 else 0

    hdr = f" {name} (c={concurrency}) "
    width = max(len(hdr) + 4, 38)
    border = "-" * width

    print(border)
    print(hdr.center(width))
    print(border)
    print(f"  Total Requests : {total}")
    print(f"  Success (2xx)  : {len(successes)}")
    print(f"  Failures       : {len(failures)}")
    print(f"  Avg Latency    : {avg:.0f}ms")
    print(f"  p50            : {p50:.0f}ms")
    print(f"  p95            : {p95:.0f}ms")
    print(f"  p99            : {p99:.0f}ms")
    print(f"  Max Latency    : {mx:.0f}ms")
    print(f"  Throughput     : {throughput:.0f} req/s")
    print(border)

    # Log non-2xx status codes if any
    bad_codes = {}
    for r in failures:
        code = r[2]
        bad_codes[code] = bad_codes.get(code, 0) + 1
    if bad_codes:
        print(f"  Error codes: {bad_codes}")
        print(border)

    print()
    return {
        "name": name,
        "concurrency": concurrency,
        "total": total,
        "successes": len(successes),
        "failures": len(failures),
        "avg": avg,
        "p50": p50,
        "p95": p95,
        "p99": p99,
        "max": mx,
        "throughput": throughput,
    }


def main():
    print("=" * 50)
    print("  STRESS TEST — hiringpipeline.vercel.app")
    print(f"  Started at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)
    print()

    tests = [
        ("TEST 1 — Baseline (Sequential)", f"{BASE}/", 20, 1),
        ("TEST 2 — Light Load", f"{BASE}/", 100, 5),
        ("TEST 3 — Moderate Load", f"{BASE}/", 200, 10),
        ("TEST 4 — Stress Point", f"{BASE}/", 200, 20),
        ("TEST 5 — Higher Stress", f"{BASE}/", 200, 50),
        ("TEST 6 — Spike Test", f"{BASE}/", 200, 100),
        ("TEST 7 — Health Endpoint", f"{BASE}/api/health", 50, 10),
    ]

    all_results = []

    for name, url, total, concurrency in tests:
        result = run_test(name, url, total, concurrency)
        all_results.append(result)
        time.sleep(0.5)

    # --- Final Verdict ---
    print()
    print("=" * 50)
    print("  FINAL VERDICT")
    print("=" * 50)

    first_failure = None
    for r in all_results:
        if r["failures"] > 0 and first_failure is None:
            first_failure = r

    if first_failure:
        rate = (first_failure["failures"] / first_failure["total"]) * 100
        print(f"  First failures at    : concurrency={first_failure['concurrency']}")
        print(f"  Failure rate there   : {rate:.1f}% ({first_failure['failures']}/{first_failure['total']})")

        # Find max safe concurrency (last test with 0 failures)
        safe = 1
        for r in all_results:
            if r["failures"] == 0:
                safe = r["concurrency"]
        print(f"  Max safe concurrency : {safe}")

        # Guess the likely cause
        if first_failure["concurrency"] >= 50:
            cause = "Likely Vercel edge/CDN throttling under high burst; static assets served well at moderate load."
        elif first_failure["concurrency"] >= 20:
            cause = "Likely Vercel cold-start queuing or connection pool limits on Supabase free tier."
        else:
            cause = "Possible origin server bottleneck or DNS resolution failures under load."
        print(f"  Likely cause         : {cause}")
    else:
        print("  No failures detected at any concurrency level!")
        print("  The app handled all test levels cleanly.")
        safe = max(r["concurrency"] for r in all_results)
        print(f"  Max tested concurrency : {safe}")

    print("=" * 50)
    print()


if __name__ == "__main__":
    main()
