<template>
	<div class="admin-panel-overlay">
		<div class="admin-panel">
			<div class="admin-header">
				<h2 class="title">User Management</h2>
				<button class="close-btn" @click="$emit('close')">
					<X :size="20" />
				</button>
			</div>

			<div class="admin-content">
				<!-- User List Sidebar -->
				<div class="user-list-section">
					<div class="list-controls">
						<input
							v-model="searchQuery"
							placeholder="Search users..."
							class="search-input"
						/>
					</div>
					<div class="user-list scrollbar-y">
						<div
							v-for="u in filteredUsers"
							:key="u.id"
							class="user-item"
							:class="{ selected: selectedUser?.id === u.id }"
							@click="selectUser(u)"
						>
							<div
								class="avatar"
								:style="{ backgroundColor: u.color || '#ccc' }"
							></div>
							<div class="user-summ">
								<div class="name-row">
									<span class="name">{{ u.display_name }}</span>
									<span v-if="u.roles.includes('admin')" class="badge admin"
										>ADMIN</span
									>
									<span v-if="u.banned_at" class="badge banned">BANNED</span>
								</div>
								<div class="email-row">{{ u.provider_email }}</div>
							</div>
							<div
								class="active-dot"
								v-if="u.is_active"
								title="Active recently"
							></div>
						</div>
					</div>
				</div>

				<!-- User Details Panel -->
				<div class="user-details-section">
					<div v-if="selectedUser" class="user-details-content scrollbar-y">
						<div class="details-header">
							<div
								class="big-avatar"
								:style="{ backgroundColor: selectedUser.color || '#ccc' }"
							></div>
							<div>
								<h3>{{ selectedUser.display_name }}</h3>
								<p class="id-text">ID: {{ selectedUser.id }}</p>
							</div>
						</div>

						<div class="info-grid">
							<div class="info-item">
								<label>Provider</label>
								<span
									>{{ selectedUser.provider }} ({{
										selectedUser.provider_id
									}})</span
								>
							</div>
							<div class="info-item">
								<label>Joined</label>
								<span>{{
									new Date(selectedUser.created_at).toLocaleString()
								}}</span>
							</div>
							<div class="info-item">
								<label>Roles</label>
								<span>{{ selectedUser.roles.join(', ') }}</span>
							</div>
						</div>

						<div class="divider"></div>

						<!-- Ban Actions -->
						<div class="moderation-section">
							<h4>Moderation</h4>

							<div v-if="!selectedUser.banned_at" class="ban-form">
								<div class="form-group">
									<label>Ban Reason</label>
									<input
										v-model="banReason"
										type="text"
										placeholder="e.g. Spamming, harassment..."
										class="input-field"
									/>
								</div>
								<div class="form-group checkbox">
									<input
										type="checkbox"
										id="delContent"
										v-model="deleteContent"
									/>
									<label for="delContent"
										>Delete all contributions (tracks, clips, files)</label
									>
								</div>
								<button
									class="btn danger"
									@click="handleBan"
									:disabled="isSubmitting"
								>
									{{ isSubmitting ? 'Banning...' : 'Ban User' }}
								</button>
							</div>

							<div v-else class="banned-state">
								<div class="alert danger">
									<div class="alert-title">User is Banned</div>
									<div>
										<strong>Date:</strong>
										{{ new Date(selectedUser.banned_at).toLocaleString() }}
									</div>
									<div>
										<strong>Reason:</strong>
										{{ selectedUser.ban_reason || 'N/A' }}
									</div>
								</div>
								<button
									class="btn secondary"
									@click="handleUnban"
									:disabled="isSubmitting"
								>
									{{ isSubmitting ? 'Unbanning...' : 'Unban User' }}
								</button>
							</div>
						</div>

						<div class="divider"></div>

						<!-- History -->
						<div class="history-section">
							<h4>Recent Activity</h4>
							<div v-if="loadingHistory" class="loading-state">
								Loading history...
							</div>
							<div v-else-if="historyItems.length === 0" class="empty-history">
								No recorded history.
							</div>
							<div v-else class="history-list">
								<div
									v-for="(item, idx) in historyItems"
									:key="idx"
									class="history-item"
								>
									<span class="time">{{
										new Date(item.timestamp).toLocaleTimeString()
									}}</span>
									<span class="action-type">{{ item.type }}</span>
									<!-- <span class="json-peek">{{ JSON.stringify(item.data).slice(0, 50) }}...</span> -->
								</div>
							</div>
						</div>
					</div>
					<div v-else class="details-placeholder">
						<p>Select a user to manage</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { socket } from '@/socket/socket'
import { X } from 'lucide-vue-next'
import type { User } from '~/schema'

// Extended user type with is_active from server response
type AdminUser = User & { is_active: boolean }
type HistoryItem = {
	type: string
	timestamp: number
	data: any
	userId: string
}

const emit = defineEmits(['close'])

const users = ref<AdminUser[]>([])
const searchQuery = ref('')
const selectedUser = ref<AdminUser | null>(null)

const banReason = ref('')
const deleteContent = ref(false)
const isSubmitting = ref(false)

const historyItems = ref<HistoryItem[]>([])
const loadingHistory = ref(false)

const filteredUsers = computed(() => {
	if (!searchQuery.value) return users.value
	const q = searchQuery.value.toLowerCase()
	return users.value.filter(
		(u) =>
			u.display_name.toLowerCase().includes(q) ||
			u.provider_email.toLowerCase().includes(q) ||
			u.id.includes(q),
	)
})

async function fetchUsers() {
	const res = await socket.emitWithAck('get:admin:users', null)
	if (res.success) {
		users.value = res.data
	} else {
		alert('Failed to fetch users: ' + res.error.message)
	}
}

async function fetchHistory(userId: string) {
	loadingHistory.value = true
	historyItems.value = []
	try {
		const res = await socket.emitWithAck('get:admin:user_history', { userId })
		if (res.success) {
			historyItems.value = res.data as HistoryItem[]
		}
	} finally {
		loadingHistory.value = false
	}
}

function selectUser(u: AdminUser) {
	selectedUser.value = u
	banReason.value = ''
	deleteContent.value = false
	fetchHistory(u.id)
}

async function handleBan() {
	if (!selectedUser.value) return
	if (!confirm(`Are you sure you want to ban ${selectedUser.value.display_name}?`)) return

	isSubmitting.value = true
	try {
		const res = await socket.emitWithAck('get:admin:ban_user', {
			userId: selectedUser.value.id,
			reason: banReason.value || null,
			deleteContent: deleteContent.value,
		})

		if (res.success) {
			// Update local state
			selectedUser.value.banned_at = new Date().toISOString()
			selectedUser.value.ban_reason = banReason.value || null
		} else {
			alert('Failed to ban user: ' + res.error.message)
		}
	} finally {
		isSubmitting.value = false
	}
}

async function handleUnban() {
	if (!selectedUser.value) return
	if (!confirm(`Unban ${selectedUser.value.display_name}?`)) return

	isSubmitting.value = true
	try {
		const res = await socket.emitWithAck('get:admin:unban_user', {
			userId: selectedUser.value.id,
		})

		if (res.success) {
			selectedUser.value.banned_at = null
			selectedUser.value.ban_reason = null
		} else {
			alert('Failed to unban user: ' + res.error.message)
		}
	} finally {
		isSubmitting.value = false
	}
}

onMounted(() => {
	fetchUsers()
})
</script>

<style scoped>
.admin-panel-overlay {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.7);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 600;
	backdrop-filter: blur(4px);
}

.admin-panel {
	background: var(--bg-color-panel);
	border: 1px solid var(--border-primary);
	border-radius: 8px;
	width: 900px;
	height: 80vh;
	display: flex;
	flex-direction: column;
	box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
	overflow: hidden;
	color: var(--text-color-primary);
}

.admin-header {
	padding: 1rem;
	border-bottom: 1px solid var(--border-primary);
	display: flex;
	justify-content: space-between;
	align-items: center;
	background: var(--bg-color-secondary);
}

.title {
	margin: 0;
	font-size: 1.2rem;
	font-weight: 600;
}

.close-btn {
	background: none;
	border: none;
	color: var(--text-color-secondary);
	cursor: pointer;
	padding: 0.5rem;
	border-radius: 4px;
}

.close-btn:hover {
	background: rgba(255, 255, 255, 0.1);
	color: var(--text-color-primary);
}

.admin-content {
	display: flex;
	flex: 1;
	overflow: hidden;
}

.user-list-section {
	width: 300px;
	border-right: 1px solid var(--border-primary);
	display: flex;
	flex-direction: column;
	background: var(--bg-color-secondary);
}

.list-controls {
	padding: 0.5rem;
	border-bottom: 1px solid var(--border-primary);
}

.search-input {
	width: 100%;
	padding: 0.5rem;
	border-radius: 4px;
	border: 1px solid var(--border-primary);
	background: var(--bg-color-main);
	color: var(--text-color-primary);
}

.user-list {
	flex: 1;
	overflow-y: auto;
}

.user-item {
	padding: 0.75rem;
	border-bottom: 1px solid var(--border-secondary);
	cursor: pointer;
	display: flex;
	gap: 0.75rem;
	align-items: center;
	position: relative;
}

.user-item:hover {
	background: rgba(255, 255, 255, 0.05);
}

.user-item.selected {
	background: var(--active-playing-color-dim);
	border-left: 3px solid var(--active-playing-color);
}

.avatar {
	width: 32px;
	height: 32px;
	border-radius: 50%;
}

.user-summ {
	flex: 1;
	min-width: 0;
}

.name-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-bottom: 2px;
}

.name {
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.badge {
	font-size: 0.7rem;
	padding: 1px 4px;
	border-radius: 3px;
	text-transform: uppercase;
	font-weight: bold;
}

.badge.admin {
	background: #7bd;
	color: #000;
}

.badge.banned {
	background: #e44;
	color: #fff;
}

.email-row {
	font-size: 0.8rem;
	color: var(--text-color-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.active-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #4ecc4e;
	position: absolute;
	right: 10px;
	top: 10px;
}

.user-details-section {
	flex: 1;
	display: flex;
	flex-direction: column;
	background: var(--bg-color-main);
	padding: 1.5rem;
	overflow-y: auto;
}

.details-placeholder {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: var(--text-color-secondary);
}

.details-header {
	display: flex;
	gap: 1rem;
	align-items: center;
	margin-bottom: 1.5rem;
}

.big-avatar {
	width: 64px;
	height: 64px;
	border-radius: 50%;
}

.id-text {
	font-family: monospace;
	color: var(--text-color-secondary);
	font-size: 0.9rem;
}

.info-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 1rem;
	margin-bottom: 1.5rem;
}

.info-item {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.info-item label {
	font-size: 0.8rem;
	color: var(--text-color-secondary);
	text-transform: uppercase;
}

.divider {
	height: 1px;
	background: var(--border-secondary);
	margin: 1.5rem 0;
}

.moderation-section {
	margin-bottom: 1rem;
}

.ban-form {
	background: rgba(255, 0, 0, 0.05);
	padding: 1rem;
	border-radius: 6px;
	border: 1px solid rgba(255, 0, 0, 0.1);
}

.btn {
	padding: 0.5rem 1rem;
	border-radius: 4px;
	border: none;
	cursor: pointer;
	font-weight: 500;
	transition: opacity 0.2s;
}

.btn:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.btn.danger {
	background: #e44;
	color: white;
}

.btn.secondary {
	background: var(--border-primary);
	color: var(--text-color-primary);
}

.input-field {
	display: block;
	width: 100%;
	padding: 0.5rem;
	margin-bottom: 0.5rem;
	background: var(--bg-color-secondary);
	border: 1px solid var(--border-primary);
	color: var(--text-color-primary);
	border-radius: 4px;
}

.form-group {
	margin-bottom: 1rem;
}

.form-group label {
	display: block;
	margin-bottom: 0.25rem;
	font-size: 0.9rem;
}

.form-group.checkbox {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.form-group.checkbox input {
	width: 16px;
	height: 16px;
}

.form-group.checkbox label {
	margin-bottom: 0;
}

.alert.danger {
	background: rgba(255, 0, 0, 0.1);
	border: 1px solid rgba(255, 0, 0, 0.2);
	padding: 1rem;
	border-radius: 6px;
	margin-bottom: 1rem;
}

.alert-title {
	font-weight: bold;
	color: #e44;
	margin-bottom: 0.5rem;
}

.history-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.history-item {
	display: grid;
	grid-template-columns: 80px 1fr;
	gap: 1rem;
	padding: 0.5rem;
	background: var(--bg-color-secondary);
	border-radius: 4px;
	font-size: 0.9rem;
}

.time {
	color: var(--text-color-secondary);
	font-family: monospace;
}

.action-type {
	font-weight: 500;
}
</style>
