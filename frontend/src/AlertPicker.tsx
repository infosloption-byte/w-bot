import React, { useEffect, useId, useRef, useState } from "react";
import "./alerts-inbox.css";

export type AlertOption = {value:string;label:string};
export function AlertPicker({
  ariaLabel,value,options,onChange,disabled=false,placeholder="Choose an option"
}: {
  ariaLabel:string;value:string;options:AlertOption[];onChange:(value:string)=>void;
  disabled?:boolean;placeholder?:string;
}) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const panelId=useId();
  useEffect(()=>{
    function close(e:PointerEvent){
      if(root.current && !root.current.contains(e.target as Node))setOpen(false);
    }
    document.addEventListener("pointerdown",close);
    return ()=>document.removeEventListener("pointerdown",close);
  },[]);
  const selected=options.find(o=>o.value===value);
  function choose(next:string){onChange(next);setOpen(false);}
  return <div className="alert-picker" ref={root}>
    <button type="button" className="alert-picker-trigger" aria-label={ariaLabel}
      aria-haspopup="listbox" aria-controls={panelId} aria-expanded={open}
      disabled={disabled} onClick={()=>setOpen(x=>!x)}
      onKeyDown={e=>{
        if(e.key==="Escape")setOpen(false);
        if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setOpen(true);}
      }}>
      <span>{selected?.label??placeholder}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="alert-picker-panel" id={panelId}
      role="listbox" aria-label={ariaLabel}
      onKeyDown={e=>{
        if(e.key==="Escape"){e.preventDefault();setOpen(false);
          root.current?.querySelector<HTMLButtonElement>(".alert-picker-trigger")?.focus();}
        if(e.key==="ArrowDown"||e.key==="ArrowUp"){
          const buttons=Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".alert-picker-choice")??[]);
          const idx=buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next=e.key==="ArrowDown"?(idx+1)%buttons.length:(idx-1+buttons.length)%buttons.length;
          buttons[next]?.focus();e.preventDefault();
        }
      }}>
      {options.map(o=><button type="button" key={o.value} role="option"
        className={"alert-picker-choice"+(o.value===value?" is-selected":"")}
        aria-selected={o.value===value} onClick={()=>choose(o.value)}>
        {o.label}{o.value===value&&<span aria-hidden="true"> ✓</span>}
      </button>)}
      {!options.length&&<div className="alert-picker-empty">No available options</div>}
    </div>}
  </div>;
}
