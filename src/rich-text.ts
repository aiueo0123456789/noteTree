const escapeHTML=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const renderInline=(text:string)=>escapeHTML(text).replace(/\*\*([^\n]+?)\*\*/g,'<strong>$1</strong>');
const cells=(line:string):string[]|null=>{
  const trimmed=line.trim();
  if(!trimmed.startsWith('|')||!trimmed.endsWith('|')||trimmed.length<2)return null;
  return trimmed.slice(1,-1).split('|').map(cell=>cell.trim());
};
/** Only supported text syntax becomes markup; source HTML is always escaped. */
export function renderContent(source:string):string{
  const lines=source.replace(/\r\n?/g,'\n').split('\n'),output:string[]=[];
  for(let i=0;i<lines.length;i++){
    const header=cells(lines[i]),separator=i+1<lines.length?cells(lines[i+1]):null;
    if(header&&separator&&header.length===separator.length&&separator.every(cell=>/^:?-{3,}:?$/.test(cell))){
      const rows:string[][]=[];
      i+=2;
      while(i<lines.length){const row=cells(lines[i]);if(!row)break;rows.push(row);i++;}
      i--;
      const columns=Math.max(header.length,...rows.map(row=>row.length));
      const rowHTML=(row:string[],tag:'th'|'td')=>'<tr>'+Array.from({length:columns},(_,index)=>`<${tag}${tag==='th'?' scope="col"':''}>${renderInline(row[index]??'')}</${tag}>`).join('')+'</tr>';
      output.push(`<div class="content-table-wrap"><table class="content-table"><thead>${rowHTML(header,'th')}</thead><tbody>${rows.map(row=>rowHTML(row,'td')).join('')}</tbody></table></div>`);
    }else output.push(renderInline(lines[i]));
  }
  return output.join('\n');
}
