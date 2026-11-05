# Sifia iOS Share Extension

P0: Print > Compartilhar > Sifia > interpretar > confirmar > registrar.

App principal: Capacitor iOS. Extensao: Share Extension nativa. Transporte: App Group `group.com.sifia.app`.

Bundle IDs: app `com.sifia.app`; extensao `com.sifia.app.share`.

No Xcode: gerar iOS com `npx cap add ios`; criar target Share Extension `SifiaShare`; ativar App Groups nos dois targets; usar `group.com.sifia.app`; adicionar os arquivos desta pasta; testar Screenshot > Compartilhar > Sifia em iPhone real.

Criterio de aceite: Sifia aparece na folha Compartilhar e entrega a imagem ao fluxo de analise sem selecao manual de arquivo.
