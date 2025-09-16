FROM node:20-alpine

WORKDIR /app

# Instalar dependências do sistema se necessário
RUN apk add --no-cache git bash

# Copiar package.json e package-lock.json (se existir)
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar código fonte
COPY . .

# Expor porta
EXPOSE 3000

# Comando padrão
CMD ["npm", "start"]