type Role = 'A' | 'B' | 'C';
type Profile = { id:string; mode:string; address:string; fingerprint?:string; jumpHostId?:string };
export function routingProfiles<T extends Profile>(hosts:T[], local:Role, addresses:Record<Role,(string | undefined)[]>, preferred?:Partial<Record<Role,string>>): {
  profiles:Partial<Record<Role,string>>; matching:Record<Role,T[]>; available:Record<Role,T[]>;
};
