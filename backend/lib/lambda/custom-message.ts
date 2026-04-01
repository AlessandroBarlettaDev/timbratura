// Lambda trigger richiamata da Cognito prima di inviare qualsiasi email.
// Intercettiamo solo il caso AdminCreateUser per personalizzare il messaggio di benvenuto.
export const handler = async (event: any) => {
  console.log('[CustomMessage] triggerSource:', event.triggerSource);
  if (event.triggerSource === 'CustomMessage_AdminCreateUser') {
    const { given_name, family_name } = event.request.userAttributes;
    event.response.emailSubject = 'Benvenuto! Completa la registrazione al portale Timbratura!';
    event.response.emailMessage = `
      <p>Ciao ${given_name} ${family_name},</p>
      <p>la tua registrazione è andata a buon fine.</p>
      <p>Per accedere al portale utilizza questa password temporanea:<br>
      <strong>Password temporanea: {####}</strong></p>
      <p>Per motivi di sicurezza, ti chiediamo di sostituire la password temporanea con una nuova personale.</p>
      <p>Clicca sul seguente link per impostare la tua nuova password:<br>
      <a href="http://localhost:4200/first-access">http://localhost:4200/first-access</a></p>
      <p>Se non hai richiesto la registrazione, ignora questa email.</p>
      <p>Grazie,<br>Il team di Timbratura!</p>
    `;
  }

  return event;
};