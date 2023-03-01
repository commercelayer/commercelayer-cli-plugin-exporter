import Command, { Flags, CliUx } from '../../base'
import Table, { HorizontalAlignment } from 'cli-table3'
import { QueryParamsList } from '@commercelayer/sdk'
import { clColor, clConfig, clOutput, clSymbol } from '@commercelayer/cli-core'


const MAX_EXPORTS = 1000

export default class ExportsList extends Command {

	static description = 'list all the created exports'

	static aliases = ['exports', 'exp:list']

	static examples = [
		'$ commercelayer exports',
		'$ cl exports:list -A',
		'$ cl exp:list',
	]

	static flags = {
		...Command.flags,
		all: Flags.boolean({
			char: 'A',
			description: `show all exports instead of first ${clConfig.api.page_max_size} only`,
			exclusive: ['limit'],
		}),
		type: Flags.string({
			char: 't',
			description: 'the type of resource exported',
			options: clConfig.exports.types as string[],
			multiple: false,
		}),
		status: Flags.string({
			char: 's',
			description: 'the export job status',
			options: clConfig.exports.statuses as string[],
			multiple: false,
		}),
		limit: Flags.integer({
			char: 'l',
			description: 'limit number of exports in output',
			exclusive: ['all'],
		}),
	}


	async run(): Promise<any> {

		const { flags } = await this.parse(ExportsList)

		if (flags.limit && (flags.limit < 1)) this.error(clColor.italic('Limit') + ' must be a positive integer')

		const cl = this.commercelayerInit(flags)


		try {

			let pageSize = clConfig.api.page_max_size
			const tableData = []
			let currentPage = 0
			let pageCount = 1
			let itemCount = 0
			let totalItems = 1

			if (flags.limit) pageSize = Math.min(flags.limit, pageSize)

			CliUx.ux.action.start('Fetching exports')
			while (currentPage < pageCount) {

				const params: QueryParamsList = {
					pageSize,
					pageNumber: ++currentPage,
					sort: ['-started_at'],
					filters: {},
				}

				if (params?.filters) {
					if (flags.type) params.filters.resource_type_eq = flags.type
					if (flags.status) params.filters.status_eq = flags.status
					if (flags.warnings) params.filters.warnings_count_gt = 0
					if (flags.warnings) params.filters.errors_count_gt = 0
				}

				// eslint-disable-next-line no-await-in-loop
				const exports = await cl.exports.list(params)

				if (exports?.length) {
					tableData.push(...exports)
					currentPage = exports.meta.currentPage
					if (currentPage === 1) {
						pageCount = this.computeNumPages(flags, exports.meta)
						totalItems = exports.meta.recordCount
					}

					itemCount += exports.length
				}

			}

			CliUx.ux.action.stop()

			this.log()

			if (tableData?.length) {

				const table = new Table({
					head: ['ID', 'Resource type', 'Status', 'Items', 'Format', 'Dry data', 'Started at'],
					// colWidths: [100, 200],
					style: {
						head: ['brightYellow'],
						compact: false,
					},
				})

				// let index = 0
				table.push(...tableData.map(e => [
					// { content: ++index, hAlign: 'right' as HorizontalAlignment },
					clColor.blueBright(e.id || ''),
					e.resource_type || '',
					{ content: this.exportStatus(e.status), hAlign: 'center' as HorizontalAlignment },
					{ content: e.records_count, hAlign: 'center' as HorizontalAlignment },
					{ content: e.format, hAlign: 'center' as HorizontalAlignment },
					{ content: (e.dry_data? clSymbol.symbols.check.small : ''), hAlign: 'center' as HorizontalAlignment },
					clOutput.localeDate(e.started_at || ''),
				]))

				this.log(table.toString())

				this.footerMessage(flags, itemCount, totalItems)

			} else this.log(clColor.italic('No exports found'))

			this.log()

			return tableData

		} catch (error: any) {
			this.handleError(error, flags)
		}

	}


	private footerMessage(flags: any, itemCount: number, totalItems: number): void {

		this.log()
		this.log(`Total displayed exports: ${clColor.yellowBright(String(itemCount))}`)
		this.log(`Total export count: ${clColor.yellowBright(String(totalItems))}`)

		if (itemCount < totalItems) {
			if (flags.all || ((flags.limit || 0) > MAX_EXPORTS)) {
				this.log()
				this.warn(`The maximum number of imports that can be displayed is ${clColor.yellowBright(String(MAX_EXPORTS))}`)
			} else
				if (!flags.limit) {
					this.log()
					const displayedMsg = `Only ${clColor.yellowBright(String(itemCount))} of ${clColor.yellowBright(String(totalItems))} records are displayed`
					if (totalItems < MAX_EXPORTS) this.warn(`${displayedMsg}, to see all existing items run the command with the ${clColor.cli.flag('--all')} flag enabled`)
					else this.warn(`${displayedMsg}, to see more items (max ${MAX_EXPORTS}) run the command with the ${clColor.cli.flag('--limit')} flag enabled`)
				}
		}

	}


	private computeNumPages(flags: any, meta: any): number {

		let numRecord = 25
		if (flags.all) numRecord = meta.recordCount
		else
			if (flags.limit) numRecord = flags.limit

		numRecord = Math.min(MAX_EXPORTS, numRecord)
		const numPages = Math.ceil(numRecord / 25)

		return numPages

	}

}