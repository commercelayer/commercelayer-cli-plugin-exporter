/* eslint-disable no-await-in-loop */
/* eslint-disable max-depth */
/* eslint-disable complexity */
import Command, { Flags, CliUx } from '../../base'
import { clToken, clColor, clConfig, clOutput } from '@commercelayer/cli-core'
import { CommerceLayerClient, ExportCreate } from '@commercelayer/sdk'
import notifier from 'node-notifier'


const securityInterval = 2


const notify = (message: string): void => {
  notifier.notify({
    title: 'Commerce Layer CLI',
    message,
    wait: true,
  })
}



const computeDelay = (): number => {

  const delayBurst = clConfig.api.requests_max_secs_burst / clConfig.api.requests_max_num_burst
  const delayAvg = clConfig.api.requests_max_secs_avg / clConfig.api.requests_max_num_avg

  const delay = Math.ceil(Math.max(delayBurst, delayAvg) * 1000)

  return delay

}



export default class ExportsCreate extends Command {

  static description = 'create a new export'

  static aliases = ['exp:create', 'export']

  static examples = [

  ]

  static flags = {
    ...Command.flags,
    type: Flags.string({
      char: 't',
      description: 'the type of resource being exported',
      required: true,
      options: clConfig.exports.types as string[],
      helpValue: clConfig.exports.types.slice(0, 4).join('|') + '|...',
      multiple: false,
    }),
    include: Flags.string({
      char: 'i',
      multiple: true,
      description: 'comma separated resources to include',
    }),
    where: Flags.string({
      char: 'w',
      multiple: true,
      description: 'comma separated list of query filters',
    }),
    'dry-data': Flags.boolean({
      char: 'D',
      description: 'skip redundant attributes',
      default: false
    }),
    format: Flags.string({
      char: 'F',
      description: 'export file format [csv|json]',
      options: ['csv', 'json'],
      default: 'json',
      exclusive: ['csv', 'json']
    }),
    csv: Flags.boolean({
      char: 'C',
      description: 'export data in CSV format',
      exclusive: ['format']
    }),
    save: Flags.string({
      char: 'x',
      description: 'save command output to file',
      multiple: false,
      exclusive: ['save-path'],
    }),
    'save-path': Flags.string({
      char: 'X',
      description: 'save command output to file and create missing path directories',
      multiple: false,
      exclusive: ['save'],
    }),
    notify: Flags.boolean({
      char: 'N',
      description: 'force system notification when export has finished',
      hidden: true,
    }),
    blind: Flags.boolean({
      char: 'b',
      description: 'execute in blind mode without showing the progress monitor',
      exclusive: ['quiet', 'silent'],
    }),
    pretty: Flags.boolean({
      char: 'P',
      description: 'prettify json output format',
      exclusive: ['csv']
    })
  }


  async checkAccessToken(jwtData: any, flags: any, client: CommerceLayerClient): Promise<any> {

    if (((jwtData.exp - securityInterval) * 1000) <= Date.now()) {

      await CliUx.ux.wait((securityInterval + 1) * 1000)

      const organization = flags.organization
      const domain = flags.domain

      const token = await clToken.getAccessToken({
        clientId: flags.clientId || '',
        clientSecret: flags.clientSecret || '',
        slug: organization,
        domain
      }).catch(error => {
        this.error('Unable to refresh access token: ' + String(error.message))
      })

      const accessToken = token?.accessToken || ''

      client.config({ organization, domain, accessToken })
      jwtData = clToken.decodeAccessToken(accessToken) as any

    }

    return jwtData

  }


  async run(): Promise<any> {

    const { flags } = await this.parse(ExportsCreate)

    const accessToken = flags.accessToken
    this.checkApplication(accessToken, ['integration', 'cli'])

    const outputPath = flags.save || flags['save-path']
    if (!outputPath) this.error('Undefined output file path')

    if (flags.pretty && ((flags.format === 'csv') || flags.csv)) this.error(`Flag ${clColor.cli.flag('Pretty')} can only be used with ${clColor.cli.value('JSON')} format`)

    const resType = flags.type
    if (!clConfig.exports.types.includes(flags.type)) this.error(`Unsupported resource type: ${clColor.style.error(resType)}`)
    const resDesc = resType.replace(/_/g, ' ')

    const notification = flags.notify || false
    const blindMode = flags.blind || false

    const format = flags.csv ? 'csv' : flags.format

    // Include flags
    const include: string[] = this.includeFlag(flags.include)
    // Where flags
    const wheres = this.whereFlag(flags.where)


    const cl = this.commercelayerInit(flags)

    const expCreate: ExportCreate = {
      resource_type: resType,
      format,
      dry_data: flags['dry-data']
    }

    if (include && (include.length > 0)) expCreate.includes = include
    if (wheres && (Object.keys(wheres).length > 0)) expCreate.filters = wheres


    try {

      let exp = await cl.exports.create(expCreate)

      if (!exp.records_count) {
        this.log(clColor.italic('\nNo records found\n'))
        this.exit()
      } else this.log(`Started export ${clColor.style.id(exp.id)}`)

      let jwtData = clToken.decodeAccessToken(accessToken) as any

      const delay = computeDelay()

      if (!blindMode) CliUx.ux.action.start(`Exporting ${resDesc}`, exp.status?.replace(/_/g, ' ') || 'waiting')
      while (!['completed', 'interrupted'].includes(exp.status || '')) {
        jwtData = await this.checkAccessToken(jwtData, flags, cl)
        exp = await cl.exports.retrieve(exp.id)
        await CliUx.ux.wait(delay)
      }
      if (!blindMode) CliUx.ux.action.stop((exp.status === 'completed' ? clColor.style.success : clColor.style.error)(exp.status))


      if (exp.status === 'completed') this.log(`\nExported ${clColor.yellowBright(exp.records_count || 0)} ${resDesc}`)
      else this.error(`Export ${exp?.id} ended with errors`)

      await this.saveOutput(exp, flags)

      // Notification
      const finishMessage = `Export of ${exp.records_count} ${resDesc} is finished!`
      if (blindMode) this.log(finishMessage)
      else
      if (notification) notify(finishMessage)

    } catch (error: any) {
      this.error(clOutput.formatError(error, flags))
    }

  }

}