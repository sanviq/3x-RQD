import type { ReactNode } from 'react';
import { Icon } from './Icon';
export function PanelTitle({eyebrow,title,children}:{eyebrow?:string;title:string;children?:ReactNode}) {
  return <div className="panel-title"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{children}</div>;
}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:string}) {return <span className={'badge '+tone}>{children}</span>;}
export function EmptyState({title,description,action,icon='scan'}:{title:string;description:string;action?:ReactNode;icon?:string}) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28}/></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Note({children,tone='neutral'}:{children:ReactNode;tone?:string}) {
  return <div className={'note '+tone}><Icon name={tone==='warning'?'warning':'info'} size={17}/><div>{children}</div></div>;
}
