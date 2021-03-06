import * as React from 'react';
import {
  Button,
  Icon,
  ListView,
  ListViewIcon,
  ListViewItem,
  Paginator,
  Sort,
  ToolbarRightContent
} from 'patternfly-react';
import { FilterSelected, StatefulFilters } from '../../components/Filters/StatefulFilters';
import { ActiveFilter } from '../../types/Filters';
import * as API from '../../services/Api';
import Namespace from '../../types/Namespace';
import {
  dicIstioType,
  filterByConfigValidation,
  filterByName,
  IstioConfigItem,
  toIstioItems
} from '../../types/IstioConfigList';
import { Link } from 'react-router-dom';
import { PfColors } from '../../components/Pf/PfColors';
import { authentication } from '../../utils/Authentication';
import { NamespaceValidations } from '../../types/IstioObjects';
import { ConfigIndicator } from '../../components/ConfigValidation/ConfigIndicator';
import { PromisesRegistry } from '../../utils/CancelablePromises';
import { ListPagesHelper } from '../../components/ListPage/ListPagesHelper';
import { IstioConfigListFilters } from './FiltersAndSorts';
import { ListComponent } from '../../components/ListPage/ListComponent';
import { SortField } from '../../types/SortFilters';
import { getFilterSelectedValues } from '../../components/Filters/CommonFilters';

interface IstioConfigListComponentState extends ListComponent.State<IstioConfigItem> {}
interface IstioConfigListComponentProps extends ListComponent.Props<IstioConfigItem> {}

class IstioConfigListComponent extends ListComponent.Component<
  IstioConfigListComponentProps,
  IstioConfigListComponentState,
  IstioConfigItem
> {
  private promises = new PromisesRegistry();

  constructor(props: IstioConfigListComponentProps) {
    super(props);
    this.state = {
      listItems: [],
      pagination: this.props.pagination,
      currentSortField: this.props.currentSortField,
      isSortAscending: this.props.isSortAscending
    };
  }

  componentDidMount() {
    this.updateListItems();
  }

  componentDidUpdate(
    prevProps: IstioConfigListComponentProps,
    prevState: IstioConfigListComponentState,
    snapshot: any
  ) {
    if (!this.paramsAreSynced(prevProps)) {
      this.setState({
        pagination: this.props.pagination,
        currentSortField: this.props.currentSortField,
        isSortAscending: this.props.isSortAscending
      });

      this.updateListItems();
    }
  }

  componentWillUnmount() {
    this.promises.cancelAll();
  }

  paramsAreSynced(prevProps: IstioConfigListComponentProps) {
    return (
      prevProps.pagination.page === this.props.pagination.page &&
      prevProps.pagination.perPage === this.props.pagination.perPage &&
      prevProps.isSortAscending === this.props.isSortAscending &&
      prevProps.currentSortField.title === this.props.currentSortField.title
    );
  }

  sortItemList(apps: IstioConfigItem[], sortField: SortField<IstioConfigItem>, isAscending: boolean) {
    return IstioConfigListFilters.sortIstioItems(apps, sortField, isAscending);
  }

  updateListItems(resetPagination?: boolean) {
    this.promises.cancelAll();

    const activeFilters: ActiveFilter[] = FilterSelected.getSelected();
    const namespacesSelected = getFilterSelectedValues(IstioConfigListFilters.namespaceFilter, activeFilters);
    const istioTypeFilters = getFilterSelectedValues(IstioConfigListFilters.istioTypeFilter, activeFilters).map(
      value => dicIstioType[value]
    );
    const istioNameFilters = getFilterSelectedValues(IstioConfigListFilters.istioNameFilter, activeFilters);
    const configValidationFilters = getFilterSelectedValues(
      IstioConfigListFilters.configValidationFilter,
      activeFilters
    );

    if (namespacesSelected.length === 0) {
      this.promises
        .register('namespaces', API.getNamespaces(authentication()))
        .then(namespacesResponse => {
          const namespaces: Namespace[] = namespacesResponse['data'];
          this.fetchConfigsAndValidations(
            namespaces.map(namespace => namespace.name),
            istioTypeFilters,
            istioNameFilters,
            configValidationFilters,
            resetPagination
          );
        })
        .catch(namespacesError => {
          if (!namespacesError.isCanceled) {
            this.handleAxiosError('Could not fetch namespace list', namespacesError);
          }
        });
    } else {
      this.fetchConfigsAndValidations(
        namespacesSelected,
        istioTypeFilters,
        istioNameFilters,
        configValidationFilters,
        resetPagination
      );
    }
  }

  updateValidation(istioItems: IstioConfigItem[], namespaceValidation: NamespaceValidations): IstioConfigItem[] {
    istioItems.forEach(istioItem => {
      if (
        namespaceValidation[istioItem.namespace] &&
        namespaceValidation[istioItem.namespace][istioItem.type] &&
        namespaceValidation[istioItem.namespace][istioItem.type][istioItem.name]
      ) {
        istioItem.validation = namespaceValidation[istioItem.namespace][istioItem.type][istioItem.name];
      }
    });
    return istioItems;
  }

  fetchConfigsAndValidations(
    namespaces: string[],
    istioTypeFilters: string[],
    istioNameFilters: string[],
    configValidationFilters: string[],
    resetPagination?: boolean
  ) {
    // Retrieve the istio config list/items and validations asynchronously
    // Both are cancelable to avoid updating the state if the component umounts before data retrieval finishes.
    const configsPromises = this.fetchIstioConfigs(namespaces, istioTypeFilters, istioNameFilters);
    const validationPromises = this.fetchValidations(namespaces);

    configsPromises
      .then(configItems => {
        // Unify validations and configs as a Promise
        const mergedItemsPromise = validationPromises.then(namespaceValidations =>
          filterByConfigValidation(this.updateValidation(configItems, namespaceValidations), configValidationFilters)
        );
        if (configValidationFilters.length > 0 || this.state.currentSortField.id === 'configvalidation') {
          // If user *is* filtering and/or sorting using "validations", we must wait until the validations are fetched in order
          // to update/sort the view. This way, we avoid a flickering list and/or ending up with a wrong sorting.
          return mergedItemsPromise;
        }
        // If user *is not* filtering nor sorting using "validations", we can show the list as soon as istio configs
        // are retrieved and update the view at a later time once the validations are fetched.
        // For that, we return "configItems" instead of "mergedItemsPromise"
        mergedItemsPromise.then(() => this.forceUpdate());
        return configItems;
      })
      .then(items =>
        IstioConfigListFilters.sortIstioItems(items, this.state.currentSortField, this.state.isSortAscending)
      )
      .then(sorted => {
        // Update the view when data is fetched
        const currentPage = resetPagination ? 1 : this.state.pagination.page;
        this.setState(prevState => {
          return {
            listItems: sorted,
            pagination: {
              page: currentPage,
              perPage: prevState.pagination.perPage,
              perPageOptions: ListPagesHelper.perPageOptions
            }
          };
        });
      })
      .catch(istioError => {
        if (!istioError.isCanceled) {
          this.handleAxiosError('Could not fetch Istio objects list', istioError);
        }
      });
  }

  // Fetch the Istio configs, apply filters and map them into flattened list items
  fetchIstioConfigs(namespaces: string[], typeFilters: string[], istioNameFilters: string[]) {
    return this.promises
      .registerAll('configs', namespaces.map(ns => API.getIstioConfig(authentication(), ns, typeFilters)))
      .then(responses => {
        let istioItems: IstioConfigItem[] = [];
        responses.forEach(response => {
          istioItems = istioItems.concat(toIstioItems(filterByName(response.data, istioNameFilters)));
        });
        return istioItems;
      });
  }

  // Fetch validations and return them as an object keyed with namespace
  fetchValidations(namespaces: string[]) {
    return this.promises
      .registerAll('validations', namespaces.map(ns => API.getNamespaceValidations(authentication(), ns)))
      .then(responses => {
        const namespaceValidations: NamespaceValidations = {};
        responses.forEach(response =>
          Object.keys(response.data).forEach(namespace => (namespaceValidations[namespace] = response.data[namespace]))
        );
        return namespaceValidations;
      });
  }

  renderIstioItem(istioItem: IstioConfigItem, index: number) {
    let to = '/namespaces/' + istioItem.namespace + '/istio';
    let name = istioItem.name;
    let iconName = '';
    let iconType = '';
    let type = 'No type found';
    if (istioItem.type === 'gateway') {
      iconName = 'route';
      iconType = 'pf';
      type = 'Gateway';
    } else if (istioItem.type === 'virtualservice') {
      iconName = 'code-fork';
      iconType = 'fa';
      type = 'VirtualService';
    } else if (istioItem.type === 'destinationrule') {
      iconName = 'network';
      iconType = 'pf';
      type = 'DestinationRule';
    } else if (istioItem.type === 'serviceentry') {
      iconName = 'services';
      iconType = 'pf';
      type = 'ServiceEntry';
    } else if (istioItem.type === 'rule') {
      iconName = 'migration';
      iconType = 'pf';
      type = 'Rule';
    } else if (istioItem.type === 'quotaspec') {
      iconName = 'process-automation';
      iconType = 'pf';
      type = 'QuotaSpec';
    } else if (istioItem.type === 'quotaspecbinding') {
      iconName = 'integration';
      iconType = 'pf';
      type = 'QuotaSpecBinding';
    }
    to = to + '/' + dicIstioType[type] + '/' + name;

    const itemDescription = (
      <table style={{ width: '30em', tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            <td>{type}</td>
            {istioItem.validation ? (
              <td>
                <strong>Config: </strong>{' '}
                <ConfigIndicator id={index + '-config-validation'} validations={[istioItem.validation]} size="medium" />
              </td>
            ) : (
              undefined
            )}
          </tr>
        </tbody>
      </table>
    );

    return (
      <Link
        key={'istioItemItem_' + index + '_' + istioItem.namespace + '_' + name}
        to={to}
        style={{ color: PfColors.Black }}
      >
        <ListViewItem
          leftContent={<ListViewIcon type={iconType} name={iconName} />}
          heading={
            <span>
              {name}
              <small>{istioItem.namespace}</small>
            </span>
          }
          description={itemDescription}
        />
      </Link>
    );
  }

  render() {
    let istioList: any = [];
    let pageStart = (this.state.pagination.page - 1) * this.state.pagination.perPage;
    let pageEnd = pageStart + this.state.pagination.perPage;
    pageEnd = pageEnd < this.state.listItems.length ? pageEnd : this.state.listItems.length;

    for (let i = pageStart; i < pageEnd; i++) {
      istioList.push(this.renderIstioItem(this.state.listItems[i], i));
    }

    let ruleListComponent;
    ruleListComponent = (
      <>
        <StatefulFilters initialFilters={IstioConfigListFilters.availableFilters} onFilterChange={this.onFilterChange}>
          <Sort>
            <Sort.TypeSelector
              sortTypes={IstioConfigListFilters.sortFields}
              currentSortType={this.state.currentSortField}
              onSortTypeSelected={this.updateSortField}
            />
            <Sort.DirectionSelector
              isNumeric={false}
              isAscending={this.state.isSortAscending}
              onClick={this.updateSortDirection}
            />
          </Sort>
          <ToolbarRightContent>
            <Button onClick={this.updateListItems}>
              <Icon name="refresh" />
            </Button>
          </ToolbarRightContent>
        </StatefulFilters>
        <ListView>{istioList}</ListView>
        <Paginator
          viewType="list"
          pagination={this.state.pagination}
          itemCount={this.state.listItems.length}
          onPageSet={this.pageSet}
          onPerPageSelect={this.perPageSelect}
        />
      </>
    );
    return <div>{ruleListComponent}</div>;
  }
}

export default IstioConfigListComponent;
