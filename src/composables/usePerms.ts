import { user } from '@/state'
import {
	checkPolicy,
	type PolicyAction,
	type PolicyCheckResult,
	type ResourceDataType,
	type ResourceFromAction,
} from '~/perms'

export function usePerms() {
	function can<A extends PolicyAction>(
		action: A,
		data?: ResourceDataType[ResourceFromAction<A>],
	): PolicyCheckResult['allowed'] {
		return checkPolicy(action, user.value, data).allowed
	}

	function canWithInfo<A extends PolicyAction>(
		action: A,
		data?: ResourceDataType[ResourceFromAction<A>],
	): PolicyCheckResult {
		return checkPolicy(action, user.value, data)
	}

	return {
		can,
		canWithInfo,
	}
}
