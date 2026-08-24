// Placeholder for site-wide JS (booking calendar logic lives inline in turf-details.ejs)
const lampChain = document.querySelector('.lamp-chain');
if (lampChain) {
	const lamp = lampChain.closest('.auth-art');
	const authPage = document.body;
	const registrationForm = document.querySelector('.auth-form');

	const setLightState = (isOff) => {
		lamp.classList.toggle('is-off', isOff);
		authPage.classList.toggle('lights-off', isOff);
		lampChain.setAttribute('aria-pressed', String(!isOff));
		registrationForm?.querySelectorAll('input, button').forEach((control) => {
			control.disabled = isOff;
		});
	};

	setLightState(false);
	lampChain.addEventListener('click', () => {
		const lamp = lampChain.closest('.auth-art');
		setLightState(!lamp.classList.contains('is-off'));
	});
}

