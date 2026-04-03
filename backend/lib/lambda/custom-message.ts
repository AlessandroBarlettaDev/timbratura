import { Resend } from 'resend';

// Invia l'email di benvenuto con le credenziali tramite Resend.
// Chiamata da users-handler al momento della creazione di un nuovo utente.
export async function sendWelcomeEmail(
  to: string,
  nome: string,
  cognome: string,
  tempPassword: string,
  appUrl: string,
): Promise<string | null> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from:    'Timbratura <onboarding@resend.dev>',
    to,
    subject: 'Benvenuto! Completa la registrazione al portale Timbratura!',
    html: `
      <p>Ciao <strong>${nome} ${cognome}</strong>,</p>
      <p>la tua registrazione è andata a buon fine.</p>
      <p>Per accedere al portale utilizza questa password temporanea:<br>
      <strong>Password temporanea: ${tempPassword}</strong></p>
      <p>Per motivi di sicurezza, ti chiediamo di sostituire la password temporanea con una nuova personale.</p>
      <p>Clicca sul seguente link per accedere:<br>
      <a href="${appUrl}/first-access">${appUrl}/first-access</a></p>
      <p>Se non hai richiesto la registrazione, ignora questa email.</p>
      <p>Grazie,<br>Il team di Timbratura!</p>
    `,
  });
  return error ? error.message : null;
}

// Lambda trigger Cognito — mantenuto per altri eventi (reset password, verifica email, ecc.).
// Per AdminCreateUser usiamo MessageAction.SUPPRESS + Resend, quindi questo non viene chiamato.
export const handler = async (event: any) => {
  return event;
};