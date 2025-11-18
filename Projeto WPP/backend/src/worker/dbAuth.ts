import { PrismaClient } from '@prisma/client'
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys'
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'

export type BaileysAuthState = {
  state: {
    creds: AuthenticationCreds
    keys: {
      get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => Promise<SignalDataTypeMap[T][]>
      set: <T extends keyof SignalDataTypeMap>(type: T, data: { [id: string]: SignalDataTypeMap[T] }) => Promise<void>
    }
  }
  saveCreds: () => Promise<void>
}

export async function usePrismaAuthState(prisma: PrismaClient, instanceId: string): Promise<BaileysAuthState> {
  const row = await prisma.whatsAuth.findUnique({ where: { instanceId } })
  // Always parse stored JSON using BufferJSON to restore binary fields correctly
  let creds = row?.creds
    ? (BufferJSON.parse(JSON.stringify(row.creds)) as AuthenticationCreds)
    : initAuthCreds()
  let keysData: any = row?.keys || {}

  const writeBack = async () => {
    await prisma.whatsAuth.upsert({
      where: { instanceId },
      create: { instanceId, creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)), keys: JSON.parse(JSON.stringify(keysData, BufferJSON.replacer)) },
      update: { creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)), keys: JSON.parse(JSON.stringify(keysData, BufferJSON.replacer)) },
    })
  }

  const auth: BaileysAuthState = {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = keysData[type] || {}
          return ids.map((id: string) => data[id]).filter(Boolean)
        },
        set: async (type, data) => {
          keysData[type] = keysData[type] || {}
          for (const id of Object.keys(data)) {
            // @ts-ignore
            keysData[type][id] = data[id]
          }
          await writeBack()
        },
      },
    },
    saveCreds: async () => {
      creds = auth.state.creds
      await writeBack()
    },
  }

  return auth
}

