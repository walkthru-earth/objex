const SAFELOCK_KEY = 'obstore-explore-safelock';

function createSafeLockStore() {
	let locked = $state(true);
	let initialized = $state(false);

	async function init() {
		if (initialized) return;

		try {
			const raw = localStorage.getItem(SAFELOCK_KEY);
			if (raw !== null) {
				locked = JSON.parse(raw) as boolean;
			}
		} catch {
			// ignore
		}

		initialized = true;
	}

	function persist() {
		try {
			localStorage.setItem(SAFELOCK_KEY, JSON.stringify(locked));
		} catch {
			// ignore
		}
	}

	function lock() {
		locked = true;
		persist();
	}

	function unlock() {
		locked = false;
		persist();
	}

	function toggle() {
		locked = !locked;
		persist();
	}

	return {
		get locked() {
			return locked;
		},
		get initialized() {
			return initialized;
		},
		init,
		lock,
		unlock,
		toggle
	};
}

export const safeLock = createSafeLockStore();
