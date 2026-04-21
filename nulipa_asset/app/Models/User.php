<?php

namespace App\Models;

 

// use Illuminate\Contracts\Auth\MustVerifyEmail;

use Database\Factories\UserFactory;

use Illuminate\Database\Eloquent\Factories\HasFactory;

use Illuminate\Foundation\Auth\User as Authenticatable;

use Illuminate\Notifications\Notifiable;

class User extends Authenticatable

{

    /** @use HasFactory<UserFactory> */

    use HasFactory, Notifiable;

 

    /**

     * The attributes that are mass assignable.

     *

     * @var array<int, string>

     */

    protected $fillable = [

        'employee_number',

        'first_name',

        'last_name',

        'email',

        'password_hash',

        'role',

        'department',

        'profile_photo',

        'qr_code_path',

        'qr_generated_at',

    ];

 

    /**

     * The attributes that should be hidden for arrays.

     *

     * @var array<int, string>

     */

    protected $hidden = [

        'password_hash',

        'remember_token',

    ];

 

    /**

     * The attributes that should be cast.

     *

     * @var array<string, string>

     */

    protected $casts = [

        'email_verified_at' => 'datetime',

        'qr_generated_at' => 'datetime',

    ];

 

    /**

     * Get the password for authentication (override to use password_hash column).

     */

    public function getAuthPassword()

    {

        return $this->password_hash;

    }

 

    /**

     * User has many asset requests.

     */

    public function assetRequests()

    {

        return $this->hasMany(\App\Models\AssetRequest::class, 'user_id', 'id');

    }

}