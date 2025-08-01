<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012, 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Enums\Action;
use Elabftw\Enums\Orderby;
use Elabftw\Enums\Sort;
use Elabftw\Enums\State;
use Elabftw\Params\BaseQueryParams;
use Elabftw\Params\OrderingParams;
use Elabftw\Params\StatusParams;
use Elabftw\Services\Check;
use Elabftw\Services\Filter;
use Elabftw\Traits\RandomColorTrait;
use Elabftw\Traits\SetIdTrait;
use PDO;
use Symfony\Component\HttpFoundation\InputBag;
use Override;

/**
 * Status for experiments or items
 */
abstract class AbstractStatus extends AbstractCategory
{
    use SetIdTrait;
    use RandomColorTrait;

    protected string $table;

    #[Override]
    public function updateOrdering(OrderingParams $params): void
    {
        $this->canWriteOrExplode();
        parent::updateOrdering($params);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/teams/%d/%s/', $this->Teams->id ?? 0, $this->table);
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        return $this->create(
            $reqBody['name'] ?? _('Untitled'),
            $reqBody['color'] ?? $this->getRandomDarkColor(),
            $reqBody['default'] ?? 0,
        );
    }

    /**
     * Create a default set of status for a new team
     */
    public function createDefault(): bool
    {
        return $this->create(_('Running'), '#' . self::DEFAULT_BLUE, 1)
        && $this->create(_('Success'), '#' . self::DEFAULT_GREEN)
        && $this->create(_('Need to be redone'), '#' . self::DEFAULT_GRAY)
        && $this->create(_('Fail'), '#' . self::DEFAULT_RED);
    }

    #[Override]
    public function readOne(): array
    {
        $sql = sprintf('SELECT id, title, color, is_default, ordering, state, team
            FROM %s WHERE id = :id', $this->table);
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->Db->fetch($req);
    }

    #[Override]
    public function getQueryParams(?InputBag $query = null): QueryParamsInterface
    {
        return new BaseQueryParams(query: $query, orderby: Orderby::Ordering, sort: Sort::Asc);
    }

    /**
     * Get all status from team
     */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = sprintf('SELECT id, title, color, is_default, ordering, state, team
            FROM %s AS entity WHERE team = :team', $this->table);
        $queryParams ??= $this->getQueryParams();
        $sql .= $queryParams->getSql();

        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Teams->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    /**
     * Get all status from team independent of state
     */
    public function readAllIgnoreState(): array
    {
        $sql = sprintf('SELECT id, title, color
            FROM %s WHERE team = :team ORDER BY ordering ASC', $this->table);
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Teams->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->canWriteOrExplode();
        foreach ($params as $key => $value) {
            $this->update(new StatusParams($key, (string) $value));
        }
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $this->canWriteOrExplode();
        // TODO fix FK constraints so it sets NULL instead of deleting entries
        // set state to deleted
        return $this->update(new StatusParams('state', (string) State::Deleted->value));
    }

    private function create(string $title, string $color, int $isDefault = 0): int
    {
        $this->canWriteOrExplode();
        $title = Filter::title($title);
        $color = Check::color($color);
        $isDefault = Filter::toBinary($isDefault);

        $sql = sprintf('INSERT INTO %s (title, color, team, is_default)
            VALUES(:title, :color, :team, :is_default)', $this->table);
        $req = $this->Db->prepare($sql);
        $req->bindParam(':title', $title);
        $req->bindParam(':color', $color);
        $req->bindParam(':team', $this->Teams->id, PDO::PARAM_INT);
        $req->bindParam(':is_default', $isDefault, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->Db->lastInsertId();
    }

    private function update(StatusParams $params): bool
    {
        // make sure there is only one default status
        if ($params->getTarget() === 'is_default' && $params->getContent() === 1) {
            $this->setDefaultFalse();
        }

        $sql = sprintf('UPDATE %s SET ' . $params->getColumn() . ' = :content WHERE id = :id', $this->table);
        $req = $this->Db->prepare($sql);
        $req->bindValue(':content', $params->getContent());
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    /**
     * Remove all the default status for a team.
     * If we set true to is_default somewhere, it's best to remove all other default
     * in the team so we won't have two default status
     */
    private function setDefaultFalse(): void
    {
        $sql = sprintf('UPDATE %s SET is_default = 0 WHERE team = :team', $this->table);
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Teams->id, PDO::PARAM_INT);
        $this->Db->execute($req);
    }
}
