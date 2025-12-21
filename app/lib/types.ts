export type RepoAllocation = {
  id: string;
  portfolioId: string;
  principal: number;
  reinvestInterest: boolean;
  capitalAdjustment: number;
  cashAccountId?: string;
  custodyAccountId?: string;
};

export type RepoSeriesDraft = {
  orgId: string;
  counterpartyId: string;
  securityTypeId: string;
  symbol: string;
  issueDate: string;
  maturityDate: string;
  rate: number;
  dayCountBasis: 360 | 365 | null;
  notes: string;
  allocations: RepoAllocation[];
};
