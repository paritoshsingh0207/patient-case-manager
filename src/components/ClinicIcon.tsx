import type { ReactNode, SVGProps } from 'react';
export type ClinicIconName='overview'|'patients'|'book'|'shield'|'logout'|'plus'|'search'|'chevron'|'clipboard'|'file'|'history'|'alert';
const paths:Record<ClinicIconName,ReactNode>={
 overview:<><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></>,
 patients:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
 book:<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M9 7h6M9 11h6"/></>,
 shield:<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
 logout:<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,
 search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
 chevron:<path d="m9 18 6-6-6-6"/>,
 clipboard:<><rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></>,
 file:<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
 history:<><path d="M3 12a9 9 0 1 0 2.7-6.4L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/></>,
 alert:<><path d="m10.29 3.86-8.1 14.14A2 2 0 0 0 3.92 21h16.16a2 2 0 0 0 1.73-3L13.7 3.86a2 2 0 0 0-3.41 0Z"/><path d="M12 9v4M12 17h.01"/></>,
};
export function ClinicIcon({name,...props}:{name:ClinicIconName}&SVGProps<SVGSVGElement>){
 return <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
 fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
 aria-hidden="true" {...props}>{paths[name]}</svg>;
}
