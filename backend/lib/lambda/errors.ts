// Mappa gli errori Cognito in risposte HTTP leggibili
export function cognitoErrorToHttp(err: any): { status: number; message: string } {
  switch (err.name) {
    case 'UsernameExistsException':
      return { status: 409, message: 'Email già registrata' };
    case 'InvalidPasswordException':
      return { status: 400, message: 'Password non valida' };
    case 'InvalidParameterException':
      return { status: 400, message: `Parametro non valido: ${err.message}` };
    case 'UserNotFoundException':
      return { status: 404, message: 'Utente non trovato' };
    default:
      return { status: 500, message: `Errore interno: ${err.message}` };
  }
}
