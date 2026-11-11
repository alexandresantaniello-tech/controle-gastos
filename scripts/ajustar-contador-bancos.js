const fs=require('fs');
const p='public/index.html';
let s=fs.readFileSync(p,'utf8');
const old=`  el.textContent = restantes > 0
    ? t('aindaPodeImportarBancos', { restantes, plural: restantes === 1 ? '' : 's' })
    : t('usouBeneficioBoasVindas');`;
const neu=`  el.textContent = restantes > 0
    ? restantes + ' de ' + LIMITE_BANCOS_BOAS_VINDAS + ' bancos disponíveis.'
    : '0 de ' + LIMITE_BANCOS_BOAS_VINDAS + ' bancos disponíveis.';`;
if(!s.includes(old)) throw new Error('Função esperada não encontrada');
s=s.replace(old,neu);
fs.writeFileSync(p,s);
console.log('Contador de bancos atualizado.');
