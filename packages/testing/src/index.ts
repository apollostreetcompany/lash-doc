export interface AcceptanceStub {
  id: string;
  description: string;
}

export const createAcceptanceStub = (id: string, description: string): AcceptanceStub => ({
  id,
  description,
});
