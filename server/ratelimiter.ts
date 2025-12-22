// i know its not necessary to have this custom written
// but i think its kinda cool :D

export class RateLimiter {
	private limits = new Map<string, { count: number; expiresAt: number }>()
	private cleanupInterval: Timer

	/**
	 * @param windowMs - Time window in milliseconds
	 * @param maxRequests - Max requests per window
	 * @param cleanupIntervalMs - Cleanup interval in milliseconds
	 */
	constructor(
		private windowMs: number,
		private maxRequests: number,
		cleanupIntervalMs = 60_000,
	) {
		this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs)
	}

	/**
	 * Checks if an ip is within the rate limit.
	 * Returns `true` if allowed, `false` if blocked.
	 *
	 * Also increments the count for that ip.
	 */
	allow(ip: string): [boolean, number, number] {
		const now = Date.now()
		const record = this.limits.get(ip)

		if (!record || now > record.expiresAt) {
			this.limits.set(ip, {
				count: 1,
				expiresAt: now + this.windowMs,
			})

			return [true, this.maxRequests - 1, now + this.windowMs]
		}

		if (record.count >= this.maxRequests) return [false, 0, record.expiresAt]
		record.count++
		return [true, Math.max(0, this.maxRequests - record.count), record.expiresAt]
	}

	getRemaining(key: string): number {
		const record = this.limits.get(key)
		if (!record || Date.now() > record.expiresAt) return this.maxRequests
		return Math.max(0, this.maxRequests - record.count)
	}

	private cleanup() {
		const now = Date.now()
		for (const [key, record] of this.limits) {
			if (now > record.expiresAt) {
				this.limits.delete(key)
			}
		}
	}

	dispose() {
		clearInterval(this.cleanupInterval)
		this.limits.clear()
	}
}
