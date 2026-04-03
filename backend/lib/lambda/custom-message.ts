// Lambda trigger Cognito — disponibile per eventi futuri (reset password, verifica email, ecc.).
// L'email di benvenuto per AdminCreateUser è gestita dal template userInvitation in cognito.ts.
export const handler = async (event: any) => {
  return event;
};