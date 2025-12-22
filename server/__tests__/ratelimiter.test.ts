import { describe, expect, test } from 'bun:test'
import { RateLimiter, getSafeIp } from '../ratelimiter'

describe('RateLimiter', () => {
	test('allows requests within limit', () => {
		// 1 second window, 2 requests max
		const limiter = new RateLimiter(1000, 2)

		// First request
		const [allowed1, remaining1] = limiter.allow('1.2.3.4')
		expect(allowed1).toBe(true)
		expect(remaining1).toBe(1)

		// Second request
		const [allowed2, remaining2] = limiter.allow('1.2.3.4')
		expect(allowed2).toBe(true)
		expect(remaining2).toBe(0)

		limiter.dispose()
	})

	test('blocks requests exceeding limit', () => {
		// 1 second window, 1 request max
		const limiter = new RateLimiter(1000, 1)

		limiter.allow('1.2.3.4')
		const [allowed] = limiter.allow('1.2.3.4')

		expect(allowed).toBe(false)

		limiter.dispose()
	})

	test('resets after window expires', async () => {
		// 100ms window, 1 request max
		const limiter = new RateLimiter(100, 1)

		limiter.allow('5.6.7.8')

		// Initial check - should be blocked
		const [allowedImmediate] = limiter.allow('5.6.7.8')
		expect(allowedImmediate).toBe(false)

		// Wait for window to pass
		await new Promise((r) => setTimeout(r, 150))

		// Should be allowed again
		const [allowedAfter] = limiter.allow('5.6.7.8')
		expect(allowedAfter).toBe(true)

		limiter.dispose()
	})

	test('tracks different IPs separately', () => {
		const limiter = new RateLimiter(1000, 1)

		// Exhaust IP A
		limiter.allow('1.1.1.1')
		const [allowedA] = limiter.allow('1.1.1.1')
		expect(allowedA).toBe(false)

		// IP B should still be fresh
		const [allowedB] = limiter.allow('2.2.2.2')
		expect(allowedB).toBe(true)

		limiter.dispose()
	})

	// Edge Cases
	test('handles invalid inputs gracefully', () => {
		const limiter = new RateLimiter(1000, 5)

		// Passing a number instead of string (runtime type error simulations)
		expect(() => limiter.allow(123 as any)).not.toThrow()

		// Passing null
		expect(() => limiter.allow(null as any)).not.toThrow()

		// Passing undefined
		expect(() => limiter.allow(undefined as any)).not.toThrow()

		limiter.dispose()
	})

	test('handles massive request volume performance', () => {
		const limiter = new RateLimiter(1000, 100000)
		const start = performance.now()

		// Simulate 10k checks
		for (let i = 0; i < 10000; i++) {
			limiter.allow('1.2.3.4')
		}

		const end = performance.now()

		// Should be reasonably fast
		expect(end - start).toBeLessThan(100)

		limiter.dispose()
	})
})

describe('getSafeIp', () => {
	test('returns fallback if no headers provided', () => {
		const headers = new Headers()
		expect(getSafeIp(headers, '127.0.0.1')).toBe('127.0.0.1')
	})

	test('returns fallback if x-forwarded-for is empty', () => {
		const headers = new Headers()
		headers.set('x-forwarded-for', '')
		expect(getSafeIp(headers, 'fallback')).toBe('fallback')
	})

	test('extracts single IP', () => {
		const headers = new Headers()
		headers.set('x-forwarded-for', '10.0.0.1')
		expect(getSafeIp(headers, 'fallback')).toBe('10.0.0.1')
	})

	test('extracts last IP from correct list (Heroku style)', () => {
		const headers = new Headers()
		// client, proxy1, proxy2
		// We trust the LAST one because Heroku appends the connecting IP there
		headers.set('x-forwarded-for', '203.0.113.1, 198.51.100.1, 10.0.0.1')
		expect(getSafeIp(headers, 'fallback')).toBe('10.0.0.1')
	})

	test('resists spoofing attempts', () => {
		const headers = new Headers()
		// Attacker sends: "fake-ip"
		// Heroku appends: "real-ip"
		// Result header: "fake-ip, real-ip"
		headers.set('x-forwarded-for', '6.6.6.6, 10.0.0.5')

		// We should get the last one (real IP), not the first one (spoofed)
		expect(getSafeIp(headers, 'fallback')).toBe('10.0.0.5')
	})

	test('handles malformed header values gracefully', () => {
		const headers = new Headers()
		headers.set('x-forwarded-for', 'not-an-ip, still-not-an-ip')
		const result = getSafeIp(headers, 'fallback')
		expect(result).toBe('still-not-an-ip') // It blindly takes the last one, which is expected behavior for this function
	})

	test('handles extra whitespace', () => {
		const headers = new Headers()
		headers.set('x-forwarded-for', '  1.1.1.1  ,  2.2.2.2  ')
		expect(getSafeIp(headers, 'fallback')).toBe('2.2.2.2')
	})
})
