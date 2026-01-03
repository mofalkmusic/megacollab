<template>
	<div class="not-supported">
		<div class="content">
			<h1 class="bold balance">Device Not Supported</h1>
			<p class="balance">
				We're sorry, but this application is a complex
				<span class="bold">Digital Audio Workstation</span>
				designed for desktop browsers.
			</p>
			<p class="small dim balance">
				Due to the complexity and performance requirements of real-time audio processing, mobile
				devices are not supported. Please access this application from a desktop or laptop computer.
			</p>
		</div>
	</div>
</template>

<style scoped>
.not-supported {
	height: 100vh;
	width: 100vw;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--bg-1);
	color: var(--text-1);
	padding: 2rem;
	padding-bottom: 5rem;
}

.content {
	max-width: 500px;
}

h1 {
	font-size: 3rem;
	margin-bottom: 1.5rem;
}

p {
	margin-bottom: 1.5rem;
}
</style>
